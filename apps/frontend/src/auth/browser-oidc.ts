import * as oauth from "oauth4webapi";
import { type BrowserOidcConfig, endpointUrl } from "./config.ts";

export const TRANSACTION_KEY = "canton-explorer.oidc.transaction";
export const TRANSACTION_TTL_MS = 5 * 60 * 1000;
const EXPIRY_MARGIN_MS = 10_000;

type Transaction = {
  kind: "login" | "logout";
  state: string;
  createdAt: number;
  issuer: string;
  clientId: string;
  redirectUri: string;
  verifier?: string;
  nonce?: string;
};

export type AuthSnapshot = {
  status: "loading" | "signed-out" | "authenticated" | "error";
  message: string | null;
};

export type BrowserPort = {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  href: () => string;
  replaceUrl: (url: string) => void;
  navigate: (url: string) => void;
  fetch: typeof fetch;
  now: () => number;
};

// Protocol operations belong to oauth4webapi. This class owns only app lifecycle and storage.
// Token responses, ID tokens and refresh tokens are never serialized or exposed to React.
export class BrowserOidcAuth {
  readonly config: BrowserOidcConfig;
  private readonly browser: BrowserPort;
  private readonly listeners = new Set<() => void>();
  private snapshot: AuthSnapshot = { status: "loading", message: null };
  private token: { value: string; expiresAt: number } | null = null;
  private metadata: Promise<oauth.AuthorizationServer> | null = null;
  private initialized: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private revision = 0;

  constructor(config: BrowserOidcConfig, browser: BrowserPort) {
    this.config = config;
    this.browser = browser;
  }

  getSnapshot = (): AuthSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(status: AuthSnapshot["status"], message: string | null = null) {
    this.snapshot = { status, message };
    for (const listener of this.listeners) listener();
  }

  private clearToken() {
    this.revision++;
    this.token = null;
    clearTimeout(this.timer);
  }

  invalidate = (message = "Your session ended. Sign in again to continue."): void => {
    this.clearToken();
    this.publish("signed-out", message);
  };

  private fail(message: string) {
    this.clearToken();
    try {
      this.browser.storage.removeItem(TRANSACTION_KEY);
    } catch {
      // Storage may be disabled. Failure messages never include provider response contents.
    }
    this.publish("error", message);
  }

  private options() {
    return {
      [oauth.allowInsecureRequests]: new URL(this.config.issuer).protocol === "http:",
      [oauth.customFetch]: (
        input: string,
        init: {
          method: string;
          headers: Record<string, string>;
          body?: URLSearchParams | undefined;
        },
      ) => {
        // Also constrain discovered endpoints when loopback HTTP is enabled for development.
        endpointUrl(String(input));
        return this.browser.fetch(input, {
          method: init.method,
          headers: init.headers,
          ...(init.body ? { body: init.body } : {}),
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal: AbortSignal.timeout(15_000),
        });
      },
    };
  }

  private discover(): Promise<oauth.AuthorizationServer> {
    this.metadata ??= (async () => {
      const issuer = new URL(this.config.issuer);
      const response = await oauth.discoveryRequest(issuer, this.options());
      const metadata = await oauth.processDiscoveryResponse(issuer, response);
      if (
        !metadata.authorization_endpoint ||
        !metadata.token_endpoint ||
        !metadata.jwks_uri ||
        (metadata.code_challenge_methods_supported &&
          !metadata.code_challenge_methods_supported.includes("S256"))
      ) {
        throw new Error("Unsupported OIDC provider");
      }
      endpointUrl(metadata.authorization_endpoint);
      return metadata;
    })().catch(() => {
      this.metadata = null;
      throw new Error("OIDC discovery failed");
    });
    return this.metadata;
  }

  private transaction(kind: Transaction["kind"]): Transaction {
    return {
      kind,
      state: oauth.generateRandomState(),
      createdAt: this.browser.now(),
      issuer: this.config.issuer,
      clientId: this.config.clientId,
      redirectUri: kind === "login" ? this.config.redirectUri : this.config.postLogoutRedirectUri,
    };
  }

  private consume(): Transaction {
    const raw = this.browser.storage.getItem(TRANSACTION_KEY);
    this.browser.storage.removeItem(TRANSACTION_KEY);
    const tx = JSON.parse(raw ?? "null") as Transaction | null;
    if (
      !tx ||
      !["login", "logout"].includes(tx.kind) ||
      typeof tx.state !== "string" ||
      !tx.state ||
      !Number.isFinite(tx.createdAt) ||
      this.browser.now() - tx.createdAt < 0 ||
      this.browser.now() - tx.createdAt >= TRANSACTION_TTL_MS ||
      tx.issuer !== this.config.issuer ||
      tx.clientId !== this.config.clientId ||
      tx.redirectUri !==
        (tx.kind === "login" ? this.config.redirectUri : this.config.postLogoutRedirectUri)
    ) {
      throw new Error("Missing or expired authentication transaction");
    }
    return tx;
  }

  initialize(): Promise<void> {
    this.initialized ??= this.callback();
    return this.initialized;
  }

  private async callback(): Promise<void> {
    const url = new URL(this.browser.href());
    const hasResponse = ["code", "state", "error", "id_token", "access_token"].some(
      (key) => url.searchParams.has(key) || new URLSearchParams(url.hash.slice(1)).has(key),
    );
    // Remove callback credentials before any asynchronous discovery, rendering or API requests.
    if (hasResponse) this.browser.replaceUrl(new URL(".", this.config.redirectUri).href);
    const revision = this.revision;
    try {
      if (!hasResponse) {
        this.browser.storage.removeItem(TRANSACTION_KEY);
        this.publish("signed-out");
        return;
      }
      const tx = this.consume();
      const destination = new URL(tx.redirectUri);
      if (url.origin !== destination.origin || url.pathname !== destination.pathname || url.hash) {
        throw new Error("Unexpected callback location");
      }
      if (tx.kind === "logout") {
        if (
          url.searchParams.getAll("state").length !== 1 ||
          url.searchParams.get("state") !== tx.state ||
          url.searchParams.has("error") ||
          url.searchParams.has("code")
        ) {
          throw new Error("Invalid logout response");
        }
        this.publish("signed-out", "You have signed out.");
        return;
      }
      if (!tx.verifier || !tx.nonce) throw new Error("Incomplete login transaction");
      const metadata = await this.discover();
      const client: oauth.Client = { client_id: this.config.clientId };
      const params = oauth.validateAuthResponse(metadata, client, url, tx.state);
      const requestedAt = this.browser.now();
      const response = await oauth.authorizationCodeGrantRequest(
        metadata,
        client,
        oauth.None(),
        params,
        this.config.redirectUri,
        tx.verifier,
        this.options(),
      );
      const result = await oauth.processAuthorizationCodeResponse(metadata, client, response, {
        expectedNonce: tx.nonce,
        requireIdToken: true,
      });
      await oauth.validateApplicationLevelSignature(metadata, response, this.options());
      if (
        result.token_type.toLowerCase() !== "bearer" ||
        typeof result.expires_in !== "number" ||
        !Number.isFinite(result.expires_in) ||
        result.expires_in * 1000 <= EXPIRY_MARGIN_MS
      ) {
        throw new Error("A Bearer access token with a usable lifetime is required");
      }
      if (revision !== this.revision) return;
      this.token = {
        value: result.access_token,
        expiresAt: requestedAt + result.expires_in * 1000 - EXPIRY_MARGIN_MS,
      };
      if (!this.checkExpiry()) return;
      this.publish("authenticated");
      this.scheduleExpiry();
    } catch {
      if (revision === this.revision) {
        this.fail("Sign-in or callback verification failed. Please try signing in again.");
      }
    }
  }

  login = async (): Promise<void> => {
    this.clearToken();
    const revision = this.revision;
    this.publish("loading");
    try {
      this.browser.storage.removeItem(TRANSACTION_KEY);
      const metadata = await this.discover();
      const tx = this.transaction("login");
      tx.verifier = oauth.generateRandomCodeVerifier();
      tx.nonce = oauth.generateRandomNonce();
      const challenge = await oauth.calculatePKCECodeChallenge(tx.verifier);
      const url = endpointUrl(metadata.authorization_endpoint as string);
      for (const [key, value] of Object.entries({
        client_id: this.config.clientId,
        redirect_uri: this.config.redirectUri,
        response_type: "code",
        response_mode: "query",
        scope: this.config.scopes,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: tx.state,
        nonce: tx.nonce,
        // Explicit login after refresh/logout permits choosing a different IdP account.
        prompt: "login",
        ...(this.config.audience ? { audience: this.config.audience } : {}),
      })) {
        url.searchParams.set(key, value);
      }
      if (revision !== this.revision) return;
      this.browser.storage.setItem(TRANSACTION_KEY, JSON.stringify(tx));
      this.browser.navigate(url.href);
    } catch {
      if (revision === this.revision) this.fail("Could not start sign-in. Please try again.");
    }
  };

  logout = async (): Promise<void> => {
    // Local sign-out completes even when the IdP is unavailable or has no logout endpoint.
    this.clearToken();
    const revision = this.revision;
    this.publish("loading");
    try {
      this.browser.storage.removeItem(TRANSACTION_KEY);
      const metadata = await this.discover();
      if (revision !== this.revision) return;
      if (!metadata.end_session_endpoint) {
        this.publish(
          "signed-out",
          "Signed out of Explorer. Your identity provider session may remain active.",
        );
        return;
      }
      const tx = this.transaction("logout");
      const url = endpointUrl(metadata.end_session_endpoint);
      url.searchParams.set("client_id", this.config.clientId);
      url.searchParams.set("post_logout_redirect_uri", this.config.postLogoutRedirectUri);
      url.searchParams.set("state", tx.state);
      this.browser.storage.setItem(TRANSACTION_KEY, JSON.stringify(tx));
      this.browser.navigate(url.href);
    } catch {
      if (revision === this.revision) {
        this.fail(
          "Signed out of Explorer, but identity provider sign-out failed. You can sign in again.",
        );
      }
    }
  };

  private checkExpiry(): boolean {
    if (!this.token || this.browser.now() >= this.token.expiresAt) {
      this.invalidate("Your session expired. Sign in again to continue.");
      return false;
    }
    return true;
  }

  private scheduleExpiry() {
    if (!this.token) return;
    this.timer = setTimeout(
      () => {
        if (this.checkExpiry()) this.scheduleExpiry();
      },
      Math.min(this.token.expiresAt - this.browser.now(), 2_147_483_647),
    );
  }

  async request(path: string): Promise<Response> {
    const base = new URL(".", this.config.redirectUri);
    const target = new URL(path, base);
    if (
      target.origin !== base.origin ||
      !target.pathname.startsWith(`${base.pathname}api/`) ||
      target.username ||
      target.password
    ) {
      throw new Error("Invalid Explorer API URL");
    }
    if (!this.token || !this.checkExpiry()) throw new Error("Sign in required");
    const revision = this.revision;
    const response = await this.browser.fetch(target.href, {
      headers: { Authorization: `Bearer ${this.token.value}` },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    if (revision !== this.revision || !this.checkExpiry()) throw new Error("Session changed");
    if (response.status === 401) this.invalidate();
    return response;
  }
}
