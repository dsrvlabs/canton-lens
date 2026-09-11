// The selected authentication profile owns credentials; every ledger request goes through it.
import { getBrowserOidcAuth, isSharedIdentity } from "../auth/runtime.ts";
import { SAID } from "./said.ts";

// This screen does not know which path it was delivered under — it could be the root, or under the console's
// `/explorer/`. So requests are built as **document-relative paths**: the current address's directory is
// the base and `api/...` is appended under it. Going out as the absolute path `/api/...` would escape to the
// root from a sub-path or collide with the console's own `/api/*`. Call sites keep `/api/...` as is; only here is it moved.
export const BASE = location.pathname.replace(/[^/]*$/, "");
export const under = (path: string): string => BASE + path.replace(/^\//, "");

export class SignInRequiredError extends Error {
  readonly entryUrl: string | null;

  constructor(entryUrl: string | null) {
    super("Sign in required");
    this.name = "SignInRequiredError";
    this.entryUrl = entryUrl;
  }
}

export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value, location.href);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export async function apiResponse<T>(path: string): Promise<{ body: T; response: Response }> {
  const auth = getBrowserOidcAuth();
  const response = auth
    ? await auth.request(under(path))
    : isSharedIdentity()
      ? await fetch(under(path), {
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
        })
      : await fetch(under(path));
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const b = (body ?? {}) as {
      login?: unknown;
      entryUrl?: unknown;
      reason?: unknown;
      error?: unknown;
    };
    // Institution BFF 401 uses the BFF's exact login URL, then the optional configured public entry;
    // neither is guessed and navigation requires user action. Browser OIDC invalidates its memory
    // credential at its own boundary. Shared-identity errors never offer individual login recovery.
    if (response.status === 401) {
      if (isSharedIdentity()) {
        throw new Error(
          "Service access is unavailable. Contact your operator; individual sign-in is not supported.",
        );
      }
      throw new SignInRequiredError(safeHttpUrl(b.login) ?? safeHttpUrl(b.entryUrl));
    }
    const reason = b.reason ?? b.error;
    throw new Error(
      (typeof reason === "string" ? SAID[reason] : undefined) ??
        `Could not fetch (${response.status})`,
    );
  }
  return { body: body as T, response };
}

export async function api<T>(path: string): Promise<T> {
  return (await apiResponse<T>(path)).body;
}

// The one line to show a person from an error object.
export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
