#!/usr/bin/env node
// **Where explorer-api is actually started.** Only three things remain in this file: validate env,
// build the `send` that goes out to the ledger, and open the socket. Paths, headers and status codes
// belong to `build-app.mjs`, and that runs without a port (`app.inject()`).
//
//   every value below is passed explicitly; there are no defaults
//   LEDGER_AUTH_MODE=caller-bearer API_PORT=7600 API_HOST=127.0.0.1 LEDGER_BASE=http://localhost:7575 node apps/backend/src/live/serve.mjs
//
// caller-bearer never manages user credentials. shared-identity explicitly owns one application
// credential and an in-memory Client Credentials token provider. Neither profile logs in end users here.
import { buildApp } from "./build-app.mjs";
import { assertServiceLedgerBase, readLedgerAuthConfig } from "../auth/config.ts";

let ledgerAuth;
try {
  ledgerAuth = readLedgerAuthConfig(process.env);
} catch {
  console.error("[explorer-api] startup refused — invalid ledger authentication configuration; see apps/backend/.env.example.");
  process.exit(1);
}

// **Environment variables have no defaults.** If a value that says where (ledger, port, bind) is missing,
// startup is refused instead of silently pointing at localhost — defaults create the mistake of being attached
// to a different ledger while believing it is right.
// The list and descriptions are in apps/backend/.env.example. Whoever starts it passes them explicitly.
const missing = [];
const need = (name) => process.env[name] || (missing.push(name), undefined);

const PORT = Number(need("API_PORT"));
// Prefer a loopback/protected private process port. Browser OIDC uses a trusted same-origin host
// to forward Browser Bearer requests; an institution BFF attaches per-user Bearer credentials;
// shared-identity relies on an operator-controlled gateway for admission to the shared Lens.
// Direct access can bypass those entry controls in any profile. Any external exposure needs
// equivalent TLS, rate limiting and network policy; no authentication proxy is inherently required.
const HOST = need("API_HOST");
const LEDGER = need("LEDGER_BASE");
// Optional API sub-path. Absent = root. If a gateway forwards a prefix as-is, set that value here.
const BASE_PATH = (process.env.BASE_PATH ?? "").replace(/\/+$/, "");
// Optional caller-bearer recovery address: the public service entry, never a guessed login route.
// Login belongs to the selected Browser PKCE flow or institution front; shared-identity ignores it.
let PUBLIC_ENTRY_URL;
if (process.env.PUBLIC_ENTRY_URL) {
  try {
    const parsed = new URL(process.env.PUBLIC_ENTRY_URL);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
      throw new Error("must be an http(s) URL without embedded credentials");
    }
    PUBLIC_ENTRY_URL = parsed.href;
  } catch {
    console.error("[explorer-api] startup refused — invalid PUBLIC_ENTRY_URL.");
    process.exit(1);
  }
}

if (missing.length > 0 || Number.isNaN(PORT)) {
  console.error(`[explorer-api] startup refused — ${missing.length ? `${missing.join(", ")} is missing` : "PORT is not a number"}.`);
  console.error("               there are no defaults — which ledger and which address to attach to is written by whoever starts it (.env.example).");
  process.exit(1);
}

// Never allow a service credential to be sent to a non-TLS remote ledger or embedded URL credentials.
// The rule lives in ../auth/config.ts so it can be tested without opening a socket; this file owns
// only the message and the exit. Loopback HTTP is for local Canton development, as in the committed
// example; a container cannot use loopback to reach its host, so it names the host instead.
if (ledgerAuth.mode === "shared-identity") {
  try {
    assertServiceLedgerBase(LEDGER, ledgerAuth);
  } catch {
    console.error("[explorer-api] startup refused — shared-identity LEDGER_BASE requires HTTPS (loopback HTTP, or a host named in SHARED_IDENTITY_INSECURE_HTTP_HOSTS, for local development only).");
    process.exit(1);
  }
}

// ── Sending ──────────────────────────────────────────────────────────────────
// Moves the selected credential's `authorization` into a header: caller-bearer comes from the router;
// shared-identity comes from the service transport. User tokens are request-scoped; only the explicit
// service provider caches an application token in memory. Credentials are never returned in responses.
// If unreachable, it throws — naming that `unreachable` is the router's job.
async function send(request) {
  const response = await fetch(`${LEDGER}${request.path}`, {
    method: request.method,
    headers: {
      authorization: request.authorization,
      ...(request.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
    ...(ledgerAuth.mode === "shared-identity" ? { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000) } : {}),
  });
  if (ledgerAuth.mode === "shared-identity" && response.status >= 400) {
    // Classify 401/403 even if the provider's body is malformed, stalled or unreadable.
    // Service-mode error bodies are never consumed, parsed, logged or returned.
    void response.body?.cancel().catch(() => {});
    return { status: response.status, body: null };
  }
  // A package download (ArchivePayload) is bytes — passed through as is rather than read as JSON (the input for reading the contract blueprint).
  if (request.responseType === "bytes" && response.ok) {
    return { status: response.status, body: new Uint8Array(await response.arrayBuffer()) };
  }
  const text = await response.text();
  // **Does not throw when the body is not JSON.** `JSON.parse` used to throw straight through, and the
  // router named what was thrown `unreachable` (504 “could not reach the node”) — **it said it could not
  // reach something it had reached.** That is the kind of false diagnosis that makes an operator suspect
  // their node. The only thing that should throw here is a genuine failure to reach it (a failed fetch).
  // If the body cannot be read, only the status code travels upward, and calling that “the node answered
  // something strange” (node_error, 502) is the layer above's job.
  if (!text) return { status: response.status, body: null };
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: null };
  }
}

const app = buildApp({ send, ledgerAuth, basePath: BASE_PATH, publicEntryUrl: PUBLIC_ENTRY_URL });

try {
  await app.listen({ port: PORT, host: HOST });
} catch (error) {
  console.error(`[explorer-api] startup failed — ${String(error?.message ?? error)}`);
  process.exit(1);
}

console.log(`[explorer-api] ${HOST}:${PORT} — ledger auth ${ledgerAuth.mode}`);
if (ledgerAuth.mode === "shared-identity") {
  console.log("[explorer-api] Shared Identity Mode does not authenticate individual users. Every request is executed using one configured Canton service identity. The operator is responsible for controlling access to the Explorer.");
}
console.log(`               keep this process port private behind the selected profile's trusted browser-facing host, BFF or operator gateway.`);
if (HOST !== "127.0.0.1" && HOST !== "localhost" && HOST !== "::1") {
  console.log(`[explorer-api] ⚠️  bound to ${HOST} — reachable from outside loopback. Enforce TLS, rate limiting and network policy; restrict access to the trusted entry layer.`);
}

// **Said out loud, every start.** A named host is a deliberate development choice, and the cost of
// it is that a credential opening the whole shared Canton scope travels where anything on the path
// can read it. If the value is set but nothing needed it, say that too — a value left behind is
// what arms the next configuration change.
if (ledgerAuth.mode === "shared-identity" && ledgerAuth.insecureHttpHosts.length > 0) {
  const plaintext = [];
  if (new URL(LEDGER).protocol === "http:") plaintext.push("LEDGER_BASE");
  if (new URL(ledgerAuth.issuer).protocol === "http:") plaintext.push("SHARED_IDENTITY_ISSUER");
  if (plaintext.length === 0) {
    console.log(`[explorer-api] ⚠️  SHARED_IDENTITY_INSECURE_HTTP_HOSTS names ${ledgerAuth.insecureHttpHosts.join(", ")} but nothing used it — every service address is HTTPS. Remove the value.`);
  } else {
    console.log(`[explorer-api] ⚠️  plaintext service transport allowed for ${ledgerAuth.insecureHttpHosts.join(", ")} — ${plaintext.join(" and ")} ${plaintext.length > 1 ? "are" : "is"} HTTP.`);
    console.log("               the client secret and the shared Canton token can be read by anything on that path.");
    console.log("               development only — remove SHARED_IDENTITY_INSECURE_HTTP_HOSTS before any deployment beyond your own machine.");
  }
}
