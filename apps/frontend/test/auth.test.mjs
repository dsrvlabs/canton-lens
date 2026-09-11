import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { readAuthConfig } from "../src/auth/config.ts";
import { BrowserOidcAuth, TRANSACTION_KEY, TRANSACTION_TTL_MS } from "../src/auth/browser-oidc.ts";

const config = {
  mode: "browser-oidc",
  issuer: "https://idp.example/realm",
  clientId: "explorer-browser",
  redirectUri: "https://explorer.example/explorer/",
  postLogoutRedirectUri: "https://explorer.example/explorer/",
  scopes: "openid profile",
  audience: "canton",
};
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "test", alg: "RS256", use: "sig" };
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (claims, key = pair.privateKey) => {
  const unsigned = `${encode({ alg: "RS256", kid: "test" })}.${encode(claims)}`;
  return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), key).toString("base64url")}`;
};
const json = (value, status = 200) => Response.json(value, { status });

function harness(t, overrides = {}) {
  const storage = new Map();
  const writes = [];
  const calls = [];
  let href = config.redirectUri;
  let now = Date.now();
  let authorization;
  let idToken;
  let tokenResponse;
  const accessToken = jwt({ iss: config.issuer, aud: "canton", sub: "alice", exp: Math.floor(now / 1000) + 300 });
  const metadata = {
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/authorize`,
    token_endpoint: `${config.issuer}/token`,
    jwks_uri: `${config.issuer}/jwks`,
    end_session_endpoint: `${config.issuer}/logout`,
    response_types_supported: ["code"],
    id_token_signing_alg_values_supported: ["RS256"],
    code_challenge_methods_supported: ["S256"],
    ...overrides.metadata,
  };
  const browser = {
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { writes.push([key, value]); storage.set(key, value); },
      removeItem: (key) => storage.delete(key),
    },
    href: () => href,
    replaceUrl: (value) => { href = value; },
    navigate: (value) => { href = value; },
    now: () => now,
    fetch: async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      assert.equal(init.credentials, "omit");
      assert.equal(init.redirect, "error");
      assert.equal(init.cache, "no-store");
      assert.equal(init.referrerPolicy, "no-referrer");
      if (url.endsWith("/.well-known/openid-configuration")) {
        if (overrides.discoveryFailure) throw new Error("untrusted provider detail");
        return json(metadata);
      }
      if (url.endsWith("/jwks")) return json({ keys: [jwk] });
      if (url.endsWith("/token")) {
        // This fake IdP verifies the real S256 proof and public-client request.
        assert.equal(init.method, "POST");
        assert.equal(init.body.get("client_id"), config.clientId);
        assert.equal(init.body.get("client_secret"), null);
        assert.equal(new Headers(init.headers).get("authorization"), null);
        assert.equal(init.body.get("grant_type"), "authorization_code");
        assert.equal(init.body.get("redirect_uri"), config.redirectUri);
        assert.equal(init.body.get("code"), "one-time-code");
        const proof = createHash("sha256").update(init.body.get("code_verifier")).digest("base64url");
        if (proof !== authorization.searchParams.get("code_challenge")) return json({ error: "invalid_grant" }, 400);
        if (overrides.tokenFailure) return json({ error: "invalid_grant", error_description: "sensitive provider detail" }, 400);
        idToken = jwt({
          iss: config.issuer,
          aud: config.clientId,
          sub: "alice",
          iat: Math.floor(now / 1000),
          exp: Math.floor(now / 1000) + 300,
          nonce: authorization.searchParams.get("nonce"),
          ...overrides.claims,
        }, overrides.signingKey);
        tokenResponse = {
          access_token: accessToken,
          id_token: idToken,
          refresh_token: "unsolicited-refresh-token",
          token_type: "Bearer",
          expires_in: 300,
          ...overrides.token,
        };
        return json(tokenResponse);
      }
      if (url.startsWith("https://explorer.example/explorer/api/")) {
        if (overrides.api) return overrides.api(url, init);
        return json({ ok: true }, overrides.apiStatus ?? 200);
      }
      throw new Error("Unexpected request");
    },
  };
  const instances = [];
  const create = () => {
    const auth = new BrowserOidcAuth(config, browser);
    instances.push(auth);
    return auth;
  };
  t.after(() => { for (const auth of instances) auth.invalidate(); });
  return {
    browser, storage, writes, calls, accessToken, create,
    get href() { return href; },
    get idToken() { return idToken; },
    get tokenResponse() { return tokenResponse; },
    setHref: (value) => { href = value; },
    advance: (ms) => { now += ms; },
    async start() {
      const auth = create();
      await auth.initialize();
      await auth.login();
      authorization = new URL(href);
      return { auth, authorization, transaction: JSON.parse(storage.get(TRANSACTION_KEY)) };
    },
    async complete(query) {
      href = `${config.redirectUri}?${query ?? new URLSearchParams({ code: "one-time-code", state: authorization.searchParams.get("state") })}`;
      const auth = create();
      const first = auth.initialize();
      assert.equal(href, config.redirectUri, "callback URL scrubbed before the first await");
      assert.equal(auth.initialize(), first, "StrictMode/duplicate initialization is idempotent");
      await first;
      return auth;
    },
  };
}

test("explicit mode and public OIDC configuration are validated", () => {
  const env = {
    VITE_AUTH_MODE: config.mode,
    VITE_OIDC_ISSUER: config.issuer,
    VITE_OIDC_CLIENT_ID: config.clientId,
    VITE_OIDC_REDIRECT_URI: config.redirectUri,
    VITE_OIDC_POST_LOGOUT_REDIRECT_URI: config.postLogoutRedirectUri,
    VITE_OIDC_SCOPES: config.scopes,
    VITE_OIDC_AUDIENCE: config.audience,
  };
  assert.deepEqual(readAuthConfig(env, config.redirectUri), config);
  assert.deepEqual(readAuthConfig({ VITE_AUTH_MODE: "institution-bff" }, config.redirectUri), { mode: "institution-bff" });
  for (const patch of [
    { VITE_AUTH_MODE: "" }, { VITE_AUTH_MODE: "auto" }, { VITE_OIDC_CLIENT_ID: "" },
    { VITE_OIDC_ISSUER: "http://idp.example" },
    { VITE_OIDC_ISSUER: "https://user:password@idp.example" },
    { VITE_OIDC_REDIRECT_URI: "https://attacker.example/" },
    { VITE_OIDC_REDIRECT_URI: "https://explorer.example/other/" },
    { VITE_OIDC_REDIRECT_URI: `${config.redirectUri}#callback` },
    { VITE_OIDC_SCOPES: "profile" }, { VITE_OIDC_SCOPES: "openid offline_access" },
  ]) assert.throws(() => readAuthConfig({ ...env, ...patch }, config.redirectUri));
});

test("discovery and fresh PKCE S256/state/nonce use only a public client", async (t) => {
  const h = harness(t);
  const first = await h.start();
  const params = first.authorization.searchParams;
  assert.equal(params.get("response_type"), "code");
  assert.equal(params.get("response_mode"), "query");
  assert.equal(params.get("code_challenge_method"), "S256");
  assert.equal(params.get("scope"), "openid profile");
  assert.equal(params.get("audience"), "canton");
  assert.equal(params.get("client_secret"), null);
  assert.equal(params.get("code_challenge"), createHash("sha256").update(first.transaction.verifier).digest("base64url"));
  for (const field of ["state", "nonce", "verifier"]) assert.ok(first.transaction[field].length >= 43);
  const second = await h.start();
  for (const field of ["state", "nonce", "verifier"]) assert.notEqual(first.transaction[field], second.transaction[field]);
  assert.equal(h.storage.size, 1);
});

test("callback validates ID token and uses only the access token for the API, never storage", async (t) => {
  const h = harness(t);
  await h.start();
  const auth = await h.complete();
  assert.equal(auth.getSnapshot().status, "authenticated");
  assert.equal(h.storage.size, 0);
  await auth.request("/explorer/api/session");
  const api = h.calls.at(-1);
  assert.equal(api.init.headers.Authorization, `Bearer ${h.accessToken}`);
  assert.notEqual(h.accessToken, h.idToken);
  for (const [key, value] of h.writes) {
    assert.equal(key, TRANSACTION_KEY);
    for (const secret of [h.accessToken, h.idToken, "unsolicited-refresh-token", "one-time-code"]) assert.ok(!value.includes(secret));
    assert.deepEqual(Object.keys(JSON.parse(value)).sort(), ["kind", "state", "createdAt", "issuer", "clientId", "redirectUri", "verifier", "nonce"].sort());
  }
  assert.ok(!JSON.stringify(auth.getSnapshot()).includes(h.accessToken));
  assert.equal(h.calls.filter((call) => call.url.endsWith("/token")).length, 1);
  assert.equal(h.calls.filter((call) => call.url.endsWith("/jwks")).length, 1);
});

for (const scenario of [
  { name: "state mismatch", query: "code=one-time-code&state=wrong" },
  { name: "missing state", query: "code=one-time-code" },
  { name: "duplicate state", query: "code=one-time-code&state=a&state=b" },
  { name: "IdP login denial", query: "error=access_denied&state=wrong&error_description=sensitive-detail" },
]) {
  test(`callback rejects ${scenario.name} and consumes the transaction`, async (t) => {
    const h = harness(t);
    await h.start();
    const auth = await h.complete(scenario.query);
    assert.equal(auth.getSnapshot().status, "error");
    assert.equal(h.storage.size, 0);
    assert.equal(h.calls.filter((call) => call.url.endsWith("/token")).length, 0);
    assert.ok(!auth.getSnapshot().message.includes("sensitive-detail"));
    await assert.rejects(auth.request("/explorer/api/session"));
  });
}

for (const scenario of [
  { name: "nonce mismatch", claims: { nonce: "wrong" } },
  { name: "missing nonce", claims: { nonce: undefined } },
  { name: "wrong ID token issuer", claims: { iss: "https://other.example" } },
  { name: "wrong ID token audience", claims: { aud: "other-client" } },
  { name: "expired ID token", claims: { exp: 1 } },
  { name: "invalid ID token signature", signingKey: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey },
  { name: "missing ID token", token: { id_token: undefined } },
  { name: "missing access token lifetime", token: { expires_in: undefined } },
  { name: "expired access token", token: { expires_in: 0 } },
  { name: "non-Bearer token", token: { token_type: "DPoP" } },
  { name: "token endpoint failure", tokenFailure: true },
]) {
  test(`callback rejects ${scenario.name}`, async (t) => {
    const h = harness(t, scenario);
    await h.start();
    const auth = await h.complete();
    assert.equal(auth.getSnapshot().status, "error");
    assert.equal(h.storage.size, 0);
    assert.ok(!auth.getSnapshot().message.includes("sensitive provider detail"));
    await assert.rejects(auth.request("/explorer/api/session"));
  });
}

test("login denial with correct state is rejected without exchanging a code", async (t) => {
  const h = harness(t);
  const { transaction } = await h.start();
  const auth = await h.complete(`error=access_denied&state=${transaction.state}`);
  assert.equal(auth.getSnapshot().status, "error");
  assert.equal(h.calls.filter((call) => call.url.endsWith("/token")).length, 0);
});

test("tampered verifier fails at the IdP", async (t) => {
  const h = harness(t);
  const { transaction } = await h.start();
  h.storage.set(TRANSACTION_KEY, JSON.stringify({ ...transaction, verifier: "x".repeat(43) }));
  assert.equal((await h.complete()).getSnapshot().status, "error");
});

test("expired and replayed transactions cannot authenticate", async (t) => {
  const h = harness(t);
  await h.start();
  h.advance(TRANSACTION_TTL_MS);
  assert.equal((await h.complete()).getSnapshot().status, "error");
  await h.start();
  const auth = await h.complete();
  assert.equal(auth.getSnapshot().status, "authenticated");
  assert.equal((await h.complete()).getSnapshot().status, "error");
});

test("refresh loses credentials and safely allows another login", async (t) => {
  const h = harness(t);
  await h.start();
  await h.complete();
  const refreshed = h.create();
  await refreshed.initialize();
  assert.equal(refreshed.getSnapshot().status, "signed-out");
  await assert.rejects(refreshed.request("/explorer/api/session"));
  await refreshed.login();
  assert.equal(new URL(h.href).pathname, "/realm/authorize");
});

test("expiry blocks requests and notifies the UI without refreshing tokens", async (t) => {
  const h = harness(t);
  await h.start();
  const auth = await h.complete();
  let changes = 0;
  auth.subscribe(() => changes++);
  h.advance(300_000);
  const calls = h.calls.length;
  await assert.rejects(auth.request("/explorer/api/session"));
  assert.equal(h.calls.length, calls);
  assert.equal(auth.getSnapshot().status, "signed-out");
  assert.ok(changes > 0);
});

test("expiration timer signs out idle users", async (t) => {
  const h = harness(t, { token: { expires_in: 11 } });
  await h.start();
  const auth = await h.complete();
  h.advance(2_000);
  await new Promise((resolve) => {
    const unsubscribe = auth.subscribe(() => { unsubscribe(); resolve(); });
  });
  assert.equal(auth.getSnapshot().status, "signed-out");
});

test("401 clears credentials; 403 preserves identity and never falls back", async (t) => {
  for (const status of [401, 403]) {
    const h = harness(t, { apiStatus: status });
    await h.start();
    const auth = await h.complete();
    assert.equal((await auth.request("/explorer/api/session")).status, status);
    assert.equal(auth.getSnapshot().status, status === 401 ? "signed-out" : "authenticated");
    assert.ok(!h.calls.some((call) => call.url.includes("/login")));
  }
});

test("credentials cannot be sent to other origins or outside the API prefix", async (t) => {
  const h = harness(t);
  await h.start();
  const auth = await h.complete();
  const calls = h.calls.length;
  for (const path of ["https://attacker.example/api/", "//attacker.example/api/", "/api/session", "/explorer/api/../../outside", "/explorer/login"]) {
    await assert.rejects(auth.request(path));
  }
  assert.equal(h.calls.length, calls);
});

test("logout clears memory before redirect and validates its one-time state", async (t) => {
  const h = harness(t);
  await h.start();
  const auth = await h.complete();
  const logout = auth.logout();
  // No access token is available even while IdP logout is pending.
  await assert.rejects(auth.request("/explorer/api/session"));
  await logout;
  const destination = new URL(h.href);
  assert.equal(destination.pathname, "/realm/logout");
  assert.equal(destination.searchParams.get("client_id"), config.clientId);
  assert.equal(destination.searchParams.get("post_logout_redirect_uri"), config.postLogoutRedirectUri);
  assert.equal(destination.searchParams.get("id_token_hint"), null);
  assert.ok(!h.href.includes(h.accessToken));
  const callback = await h.complete(`state=${destination.searchParams.get("state")}`);
  assert.equal(callback.getSnapshot().status, "signed-out");
  assert.equal(h.storage.size, 0);
  await auth.logout();
  assert.equal((await h.complete("state=wrong")).getSnapshot().status, "error");
});

test("logout without IdP support still clears local identity", async (t) => {
  const h = harness(t, { metadata: { end_session_endpoint: undefined } });
  await h.start();
  const auth = await h.complete();
  await auth.logout();
  assert.equal(auth.getSnapshot().status, "signed-out");
  assert.equal(h.storage.size, 0);
  await assert.rejects(auth.request("/explorer/api/session"));
});

test("discovery failure, wrong issuer and unsupported PKCE fail closed", async (t) => {
  for (const override of [
    { discoveryFailure: true },
    { metadata: { issuer: "https://wrong.example" } },
    { metadata: { code_challenge_methods_supported: ["plain"] } },
    { metadata: { authorization_endpoint: "http://unsafe.example/authorize" } },
  ]) {
    const h = harness(t, override);
    const auth = h.create();
    await auth.initialize();
    await auth.login();
    assert.equal(auth.getSnapshot().status, "error");
    assert.equal(h.href, config.redirectUri);
    assert.equal(h.storage.size, 0);
  }
});

test("blocked transaction storage shows a recoverable failure", async (t) => {
  const h = harness(t);
  h.browser.storage.setItem = () => { throw new Error("blocked"); };
  const auth = h.create();
  await auth.initialize();
  await auth.login();
  assert.equal(auth.getSnapshot().status, "error");
  assert.equal(h.href, config.redirectUri);
});

test("a response started before logout cannot restore ledger data", async (t) => {
  let finish;
  const h = harness(t, { api: () => new Promise((resolve) => { finish = resolve; }) });
  await h.start();
  const auth = await h.complete();
  const pending = auth.request("/explorer/api/session");
  const rejected = assert.rejects(pending, /Session changed/);
  await auth.logout();
  finish(json({ private: "ledger data" }));
  await rejected;
});

test("actual frontend API client carries the access token through Backend to Canton", async (t) => {
  const { buildApp } = await import("@canton-lens/backend/build-app");
  const ledgerTokens = [];
  const app = buildApp({
    ledgerAuth: { mode: "caller-bearer" },
    basePath: "/explorer",
    send: async (request) => {
      ledgerTokens.push(request.authorization);
      return { status: 200, body: request.path.endsWith("/rights") ? { rights: [] } : { user: { id: "alice", isDeactivated: false } } };
    },
  });
  t.after(() => app.close());
  const h = harness(t, {
    api: async (url, init) => {
      const result = await app.inject({ method: "GET", url: new URL(url).pathname, headers: init.headers });
      return new Response(result.body, { status: result.statusCode, headers: result.headers });
    },
  });
  const { transaction } = await h.start();
  h.setHref(`${config.redirectUri}?code=one-time-code&state=${transaction.state}`);
  globalThis.location = new URL(config.redirectUri);
  globalThis.window = {
    sessionStorage: h.browser.storage,
    location: { get href() { return h.href; }, assign: h.browser.navigate },
    history: { replaceState: (_state, _title, url) => h.browser.replaceUrl(url) },
    fetch: h.browser.fetch,
    addEventListener() {},
  };
  t.after(() => { delete globalThis.window; delete globalThis.location; });
  const { configureAuth } = await import("../src/auth/runtime.ts");
  const auth = configureAuth(config);
  t.after(() => auth.invalidate());
  await auth.initialize();
  assert.equal(auth.getSnapshot().status, "authenticated");
  const { apiResponse } = await import("../src/api/client.ts");
  const response = await apiResponse("/api/session");
  assert.equal(response.response.status, 200);
  assert.ok(ledgerTokens.length > 0);
  for (const token of ledgerTokens) assert.equal(token, `Bearer ${h.accessToken}`);
  assert.ok(!JSON.stringify(response.body).includes(h.accessToken));
});
