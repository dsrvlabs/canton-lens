import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { type TestContext, test } from "node:test";
import { interpretLedgerResponse } from "@canton-lens/core";
import type { AuthorizedLedgerRequest } from "../ledger-send-with-token.ts";
import { buildApp } from "../live/build-app.mjs";
import { assertServiceLedgerBase, readLedgerAuthConfig } from "./config.ts";
import { serviceRequest } from "./service-request.ts";
import { EXPIRY_MARGIN_MS, ServiceTokenProvider } from "./service-token.ts";

const secret = "synthetic: secret+&";
const env = {
  LEDGER_AUTH_MODE: "shared-identity",
  SHARED_IDENTITY_ISSUER: "https://idp.example/realm",
  SHARED_IDENTITY_CLIENT_ID: "explorer: service",
  SHARED_IDENTITY_CLIENT_SECRET: secret,
  SHARED_IDENTITY_SCOPES: "ledger.read",
  SHARED_IDENTITY_AUDIENCE: "https://canton.example",
};
const metadata = {
  issuer: env.SHARED_IDENTITY_ISSUER,
  token_endpoint: "https://idp.example/oauth/token",
  token_endpoint_auth_methods_supported: ["client_secret_basic"],
  grant_types_supported: ["client_credentials"],
};
const config = () => {
  const value = readLedgerAuthConfig(env);
  assert.equal(value.mode, "shared-identity");
  if (value.mode !== "shared-identity") throw new Error();
  return value;
};
const sharedConfig = (extra: Record<string, string | undefined> = {}) => {
  const value = readLedgerAuthConfig({ ...env, ...extra });
  if (value.mode !== "shared-identity") throw new Error();
  return value;
};
const validToken = (n = 1) => ({
  access_token: `synthetic-service-${n}`,
  token_type: "Bearer",
  expires_in: 60,
  refresh_token: "unsolicited-refresh-must-be-discarded",
});

function harness(t: TestContext, basePath = "") {
  let time = 100_000;
  let calls = 0;
  const oauthRequests: { url: string; init: RequestInit | undefined }[] = [];
  const cantonRequests: AuthorizedLedgerRequest[] = [];
  let discoveryCalls = 0;
  let discoveryResponse = () => Response.json(metadata);
  let tokenResponse = () => Promise.resolve(Response.json(validToken(calls)));
  let cantonStatus = 200;
  const oauthFetch: typeof fetch = async (url, init) => {
    if (String(url).includes("/.well-known/")) {
      discoveryCalls++;
      assert.equal(String(url), `${env.SHARED_IDENTITY_ISSUER}/.well-known/openid-configuration`);
      assert.equal(new Headers(init?.headers).get("authorization"), null);
      return discoveryResponse();
    }
    calls++;
    oauthRequests.push({ url: String(url), init });
    return tokenResponse();
  };
  const app = buildApp({
    ledgerAuth: config(),
    basePath,
    publicEntryUrl: "https://explorer.example/login",
    serviceTokenOptions: { fetch: oauthFetch, now: () => time },
    send: async (request) => {
      cantonRequests.push(request as AuthorizedLedgerRequest);
      return {
        status: cantonStatus,
        body:
          cantonStatus !== 200
            ? { error: `${secret} synthetic-service-1` }
            : request.path === "/v2/authenticated-user"
              ? { user: { id: "shared-service", primaryParty: "shared-party" } }
              : { rights: [{ kind: { CanReadAs: { value: { party: "shared-party" } } } }] },
      };
    },
  });
  t.after(() => app.close());
  return {
    app,
    oauthRequests,
    cantonRequests,
    calls: () => calls,
    discoveryCalls: () => discoveryCalls,
    discoveryResponse: (fn: typeof discoveryResponse) => {
      discoveryResponse = fn;
    },
    advance: (ms: number) => {
      time += ms;
    },
    tokenResponse: (fn: typeof tokenResponse) => {
      tokenResponse = fn;
    },
    cantonStatus: (status: number) => {
      cantonStatus = status;
    },
    session: () => app.inject({ method: "GET", url: `${basePath}/api/session` }),
  };
}

test("mode selection is explicit; required/contradictory/unknown configuration fails closed", () => {
  assert.deepEqual(readLedgerAuthConfig({ LEDGER_AUTH_MODE: "caller-bearer" }), {
    mode: "caller-bearer",
  });
  for (const mode of [undefined, "", "browser-oidc", "auto"]) {
    assert.throws(() => readLedgerAuthConfig({ LEDGER_AUTH_MODE: mode }));
  }
  for (const key of [
    "SHARED_IDENTITY_ISSUER",
    "SHARED_IDENTITY_CLIENT_ID",
    "SHARED_IDENTITY_CLIENT_SECRET",
    "SHARED_IDENTITY_SCOPES",
  ]) {
    for (const value of [undefined, "", "   "])
      assert.throws(() => readLedgerAuthConfig({ ...env, [key]: value }));
  }
  for (const key of Object.keys(env).filter((key) => key.startsWith("SHARED_IDENTITY_"))) {
    assert.throws(() => readLedgerAuthConfig({ LEDGER_AUTH_MODE: "caller-bearer", [key]: "" }));
  }
  for (const key of [
    "SHARED_IDENTITY_RESOURCE",
    "SHARED_IDENTITY_TOKEN_ENDPOINT",
    "SHARED_IDENTITY_CLIENT_AUTH_METHOD",
    "SHARED_IDENTITY_ALLOW_LOOPBACK_HTTP",
  ]) {
    assert.throws(() => readLedgerAuthConfig({ ...env, [key]: "unsupported" }));
  }
  assert.throws(() =>
    readLedgerAuthConfig({ ...env, SHARED_IDENTITY_SCOPES: "ledger.read offline_access" }),
  );
  assert.throws(() => readLedgerAuthConfig({ ...env, SHARED_IDENTITY_AUDIENCE: "" }));
  // Runtime callers, not only TypeScript, must select a mode.
  // @ts-expect-error deliberately missing required configuration
  assert.throws(() => buildApp({ send: async () => ({ status: 200, body: null }) }));
});

test("endpoint TLS, credential, query and fragment restrictions; explicit loopback only", () => {
  for (const url of [
    "http://idp.example/token",
    "https://user:secret@idp.example/token",
    "https://idp.example/token?secret=x",
    "https://idp.example/token#x",
    "file:///tmp/token",
    "bad-secret-url",
  ]) {
    assert.throws(
      () => readLedgerAuthConfig({ ...env, SHARED_IDENTITY_ISSUER: url }),
      (error: Error) => !error.message.includes(url),
    );
  }
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const local = { ...env, SHARED_IDENTITY_ISSUER: `http://${host}:8080/realm` };
    assert.equal(readLedgerAuthConfig(local).mode, "shared-identity");
  }
});

// A container cannot reach its host through a loopback name, so the loopback allowance alone shuts
// a containerised Backend out of every local HTTP stack. A deployment names the hosts it means
// instead of switching the requirement off, which is what keeps a forgotten value from covering a
// production ledger: that ledger is not called `host.docker.internal`.
test("plaintext service transport reaches only the hosts a deployment names", () => {
  // Naming nothing changes nothing.
  assert.deepEqual(sharedConfig().insecureHttpHosts, []);
  assert.throws(() =>
    readLedgerAuthConfig({ ...env, SHARED_IDENTITY_ISSUER: "http://idp.example/realm" }),
  );

  // A named host lifts the scheme requirement for that host, and for no other.
  assert.deepEqual(
    sharedConfig({
      SHARED_IDENTITY_ISSUER: "http://host.docker.internal:8280/realm",
      SHARED_IDENTITY_INSECURE_HTTP_HOSTS: "host.docker.internal",
    }).insecureHttpHosts,
    ["host.docker.internal"],
  );
  assert.throws(() =>
    readLedgerAuthConfig({
      ...env,
      SHARED_IDENTITY_ISSUER: "http://other.example/realm",
      SHARED_IDENTITY_INSECURE_HTTP_HOSTS: "host.docker.internal",
    }),
  );

  // Only the scheme is lifted. Embedded credentials, query and fragment stay refused.
  for (const url of [
    "http://user:secret@host.docker.internal/realm",
    "http://host.docker.internal/realm?x=1",
    "http://host.docker.internal/realm#x",
  ]) {
    assert.throws(() =>
      readLedgerAuthConfig({
        ...env,
        SHARED_IDENTITY_ISSUER: url,
        SHARED_IDENTITY_INSECURE_HTTP_HOSTS: "host.docker.internal",
      }),
    );
  }

  // Commas and spaces separate; anything that is not a bare hostname is refused rather than matched
  // loosely, so a wildcard cannot stand in for the list.
  assert.deepEqual(
    sharedConfig({ SHARED_IDENTITY_INSECURE_HTTP_HOSTS: " canton,  keycloak " }).insecureHttpHosts,
    ["canton", "keycloak"],
  );
  for (const value of ["*", "http://canton", "canton:7575", "canton/path", "canton_1", "[::1"]) {
    assert.throws(() =>
      readLedgerAuthConfig({ ...env, SHARED_IDENTITY_INSECURE_HTTP_HOSTS: value }),
    );
  }

  // caller-bearer holds no service credential, so naming a host there is contradictory, not lenient.
  assert.throws(() =>
    readLedgerAuthConfig({
      LEDGER_AUTH_MODE: "caller-bearer",
      SHARED_IDENTITY_INSECURE_HTTP_HOSTS: "host.docker.internal",
    }),
  );
});

test("the shared credential's ledger address: HTTPS, a loopback host, or a named host", () => {
  const remoteIssuer = sharedConfig();
  const localIssuer = sharedConfig({ SHARED_IDENTITY_ISSUER: "http://localhost:8080/realm" });
  const namedIssuer = sharedConfig({
    SHARED_IDENTITY_ISSUER: "http://host.docker.internal:8280/realm",
    SHARED_IDENTITY_INSECURE_HTTP_HOSTS: "host.docker.internal",
  });

  // HTTPS is accepted whatever the issuer looks like.
  for (const auth of [remoteIssuer, localIssuer, namedIssuer]) {
    assertServiceLedgerBase("https://canton.example", auth);
  }

  // One local development stack: a plaintext ledger beside a plaintext issuer.
  assertServiceLedgerBase("http://localhost:7575", localIssuer);
  assertServiceLedgerBase("http://host.docker.internal:7575", namedIssuer);

  // Plaintext to a ledger nobody named stays refused, and naming some other host does not help.
  assert.throws(() => assertServiceLedgerBase("http://canton.example", remoteIssuer));
  assert.throws(() => assertServiceLedgerBase("http://canton.example", namedIssuer));

  // A plaintext ledger reached while the IdP is on TLS is the mixed configuration the pairing
  // refuses: it is not one local stack.
  assert.throws(() => assertServiceLedgerBase("http://localhost:7575", remoteIssuer));

  // Only the scheme is lifted; the rest of the address is held to the same rules, and the value
  // never reaches the error.
  for (const base of [
    "http://host.docker.internal:7575?x=1",
    "http://host.docker.internal:7575#x",
    `http://${secret}@host.docker.internal:7575`,
    "not-a-url",
  ]) {
    assert.throws(
      () => assertServiceLedgerBase(base, namedIssuer),
      (error: Error) => !error.message.includes(base) && !error.message.includes(secret),
    );
  }
});

test("startup refuses invalid modes/configuration without printing configured secrets or opening a socket", () => {
  for (const extra of [
    { LEDGER_AUTH_MODE: "" },
    { LEDGER_AUTH_MODE: "auto" },
    { LEDGER_AUTH_MODE: "caller-bearer", SHARED_IDENTITY_CLIENT_SECRET: secret },
    { ...env, SHARED_IDENTITY_CLIENT_SECRET: "" },
    { ...env, SHARED_IDENTITY_ISSUER: `https://${secret}@bad.example/realm` },
    { ...env, LEDGER_BASE: "http://remote.example" },
    { ...env, SHARED_IDENTITY_INSECURE_HTTP_HOSTS: "*" },
    // Naming one host does not open a plaintext ledger on another.
    {
      ...env,
      LEDGER_BASE: "http://remote.example",
      SHARED_IDENTITY_INSECURE_HTTP_HOSTS: "other.example",
    },
  ]) {
    const child = spawnSync(
      process.execPath,
      [new URL("../live/serve.mjs", import.meta.url).pathname],
      {
        env: {
          PATH: process.env.PATH,
          API_PORT: "7600",
          API_HOST: "127.0.0.1",
          LEDGER_BASE: "https://canton.example",
          ...extra,
        },
        encoding: "utf8",
        timeout: 5000,
      },
    );
    assert.equal(child.status, 1, child.stderr);
    assert.match(child.stderr, /startup refused/);
    assert.ok(!`${child.stdout}${child.stderr}`.includes(secret));
  }
});

test("Client Credentials uses Basic (OAuth form encoding), scope and only optional audience", async (t) => {
  const h = harness(t);
  assert.equal((await h.session()).statusCode, 200);
  const request = h.oauthRequests[0];
  assert.ok(request);
  assert.equal(request.url, metadata.token_endpoint);
  assert.equal(h.discoveryCalls(), 1);
  assert.equal(request.init?.method, "POST");
  const headers = new Headers(request.init?.headers);
  const encoded = headers.get("authorization")?.slice("Basic ".length);
  assert.ok(encoded);
  assert.equal(
    Buffer.from(encoded, "base64").toString(),
    "explorer%3A+service:synthetic%3A+secret%2B%26",
  );
  assert.deepEqual(Object.fromEntries(new URLSearchParams(String(request.init?.body))), {
    grant_type: "client_credentials",
    scope: "ledger.read",
    audience: "https://canton.example",
  });
  assert.equal(request.init?.redirect, "error");
  assert.equal(request.init?.cache, "no-store");
  assert.equal(request.init?.credentials, "omit");
  assert.ok(request.init?.signal);
});

test("all callers share one Canton identity; service tokens/claims and secrets never enter API responses", async (t) => {
  const h = harness(t);
  const first = await h.session();
  const second = await h.session();
  assert.equal(first.statusCode, 200);
  assert.equal(second.json().userId, "shared-service");
  assert.equal(first.json().parties[0].party, "shared-party");
  assert.equal(first.json().token, null);
  assert.equal(h.calls(), 1);
  assert.equal(h.cantonRequests.length, 4);
  for (const request of h.cantonRequests)
    assert.equal(request.authorization, "Bearer synthetic-service-1");
  for (const value of [secret, "synthetic-service-1", "unsolicited-refresh"])
    assert.ok(!first.body.includes(value));
  assert.equal(first.headers["cache-control"], "no-store");
});

test("incoming Authorization including empty/non-Bearer is rejected before OAuth or Canton, also under BASE_PATH", async (t) => {
  const h = harness(t, "/explorer");
  for (const authorization of ["", "Bearer user-token", "Basic caller", "bearer user-token"]) {
    for (const url of ["/explorer/api/session", "/explorer/api/party/%", "/explorer/api/unknown"]) {
      const response = await h.app.inject({ method: "GET", url, headers: { authorization } });
      assert.equal(response.statusCode, 409);
      assert.deepEqual(response.json(), { reason: "shared_identity_authorization_not_allowed" });
    }
  }
  assert.equal(h.calls(), 0);
  assert.equal(h.cantonRequests.length, 0);
});

test("public OpenAPI reflects the service profile and never acquires a token", async (t) => {
  const h = harness(t, "/explorer");
  const response = await h.app.inject({
    url: "/explorer/openapi.json",
    headers: { authorization: "Bearer ignored" },
  });
  assert.equal(response.statusCode, 200);
  const doc = response.json();
  assert.deepEqual(doc.security, []);
  assert.deepEqual(doc.servers, [{ url: "/explorer" }]);
  for (const item of Object.values(doc.paths) as {
    get: { responses: Record<string, unknown> };
  }[]) {
    assert.ok(item.get.responses["503"]);
    assert.ok(item.get.responses["409"]);
    assert.equal(item.get.responses["401"], undefined);
  }
  assert.equal(h.calls(), 0);
  assert.equal(h.discoveryCalls(), 0);
  assert.ok(!response.body.includes(secret));
});

for (const [name, response] of Object.entries({
  "issuer mismatch": () => Response.json({ ...metadata, issuer: "https://other.example" }),
  "missing token endpoint": () => Response.json({ issuer: metadata.issuer }),
  "insecure endpoint": () =>
    Response.json({ ...metadata, token_endpoint: "http://idp.example/token" }),
  "TLS downgrade to loopback": () =>
    Response.json({ ...metadata, token_endpoint: "http://localhost:8080/token" }),
  "embedded endpoint secret": () =>
    Response.json({ ...metadata, token_endpoint: "https://user:secret@idp.example/token" }),
  "unsupported auth method": () =>
    Response.json({ ...metadata, token_endpoint_auth_methods_supported: ["client_secret_post"] }),
  "unsupported grant": () =>
    Response.json({ ...metadata, grant_types_supported: ["authorization_code"] }),
  "discovery error": () => Response.json({ error: secret }, { status: 503 }),
  "discovery redirect": () =>
    new Response(null, { status: 302, headers: { location: "https://other.example" } }),
})) {
  test(`Discovery ${name} is sanitized and fails before sending the secret`, async (t) => {
    const h = harness(t);
    h.discoveryResponse(response);
    const failed = await h.session();
    assert.equal(failed.statusCode, 503);
    assert.deepEqual(failed.json(), { reason: "shared_identity_unavailable" });
    assert.equal(h.calls(), 0);
    h.discoveryResponse(() => Response.json(metadata));
    assert.equal((await h.session()).statusCode, 200);
  });
}

test("audience can be omitted; Basic is the only method even when Discovery omits method metadata", async () => {
  const withoutAudience = config();
  delete withoutAudience.audience;
  const provider = new ServiceTokenProvider(withoutAudience, {
    fetch: async (url, init) => {
      if (String(url).includes("/.well-known/"))
        return Response.json({ issuer: metadata.issuer, token_endpoint: metadata.token_endpoint });
      assert.equal(new URLSearchParams(String(init?.body)).has("audience"), false);
      assert.match(new Headers(init?.headers).get("authorization") ?? "", /^Basic /);
      return Response.json(validToken());
    },
  });
  await provider.get();
});

test("explicit loopback issuer permits local discovery/token HTTP without enabling remote HTTP", async () => {
  const provider = new ServiceTokenProvider(
    { ...config(), issuer: "http://localhost:8080/realm" },
    {
      fetch: async (url) =>
        Response.json(
          String(url).includes("/.well-known/")
            ? {
                issuer: "http://localhost:8080/realm",
                token_endpoint: "http://localhost:8080/token",
              }
            : validToken(),
        ),
    },
  );
  assert.equal((await provider.get()).value, validToken().access_token);
});

test("a named host permits Discovery and token HTTP for itself and for nowhere else", async () => {
  const auth = sharedConfig({
    SHARED_IDENTITY_ISSUER: "http://host.docker.internal:8280/realm",
    SHARED_IDENTITY_INSECURE_HTTP_HOSTS: "host.docker.internal",
  });
  const discovered = (tokenEndpoint: string) => ({
    issuer: auth.issuer,
    token_endpoint: tokenEndpoint,
    token_endpoint_auth_methods_supported: ["client_secret_basic"],
    grant_types_supported: ["client_credentials"],
  });
  const providerFor = (tokenEndpoint: string) =>
    new ServiceTokenProvider(auth, {
      fetch: async (url) =>
        Response.json(
          String(url).includes("/.well-known/") ? discovered(tokenEndpoint) : validToken(),
        ),
    });

  assert.equal(
    (await providerFor("http://host.docker.internal:8280/token").get()).value,
    validToken().access_token,
  );
  // Discovery answers with an address of its choosing; it cannot move the token endpoint onto a
  // host this deployment never named, and the secret is not sent there.
  await assert.rejects(() => providerFor("http://idp.example/token").get());
});

test("cache reused until expiry margin, then reacquired with Client Credentials", async (t) => {
  const h = harness(t);
  await h.session();
  h.advance(60_000 - EXPIRY_MARGIN_MS - 1);
  await h.session();
  assert.equal(h.calls(), 1);
  h.advance(1);
  assert.equal((await h.session()).statusCode, 200);
  assert.equal(h.calls(), 2);
  assert.equal(h.cantonRequests.at(-1)?.authorization, "Bearer synthetic-service-2");
});

test("concurrent API calls acquire only one token", async (t) => {
  const h = harness(t);
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  h.tokenResponse(async () => {
    await gate;
    return Response.json(validToken());
  });
  const responses = Array.from({ length: 12 }, () => h.session());
  setImmediate(() => release?.());
  for (const response of await Promise.all(responses)) assert.equal(response.statusCode, 200);
  assert.equal(h.calls(), 1);
});

for (const [name, response] of Object.entries({
  "invalid client": () =>
    Response.json({ error: "invalid_client", error_description: secret }, { status: 400 }),
  "provider unavailable": () => new Response(secret, { status: 503 }),
  redirect: () =>
    new Response(null, { status: 302, headers: { location: "https://other.example" } }),
  "invalid JSON": () => new Response(secret, { headers: { "content-type": "application/json" } }),
  "missing access token": () => Response.json({ token_type: "Bearer", expires_in: 60 }),
  "non-Bearer": () => Response.json({ ...validToken(), token_type: "DPoP" }),
  "bad token characters": () =>
    Response.json({ ...validToken(), access_token: "token\r\ninjected" }),
  "missing expiry": () => Response.json({ access_token: "synthetic", token_type: "Bearer" }),
  "zero expiry": () => Response.json({ ...validToken(), expires_in: 0 }),
  "negative expiry": () => Response.json({ ...validToken(), expires_in: -1 }),
  "too short expiry": () => Response.json({ ...validToken(), expires_in: 10 }),
  "overflow expiry": () => Response.json({ ...validToken(), expires_in: 1e100 }),
  "non-number expiry": () => Response.json({ ...validToken(), expires_in: "sixty" }),
  "network/timeout": () => {
    throw new Error(secret);
  },
})) {
  test(`${name}: sanitized 503, no login recovery, no Canton request, later acquisition can recover`, async (t) => {
    const h = harness(t);
    h.tokenResponse(async () => response());
    const failed = await h.session();
    assert.equal(failed.statusCode, 503);
    assert.deepEqual(failed.json(), { reason: "shared_identity_unavailable" });
    assert.equal(h.cantonRequests.length, 0);
    h.tokenResponse(async () => Response.json(validToken()));
    assert.equal((await h.session()).statusCode, 200);
    assert.equal(h.calls(), 2);
  });
}

test("slow token endpoint cannot extend the usable lifetime", async (t) => {
  const h = harness(t);
  h.tokenResponse(async () => {
    h.advance(51_000);
    return Response.json(validToken());
  });
  assert.equal((await h.session()).statusCode, 503);
  assert.equal(h.cantonRequests.length, 0);
});

test("Canton 401 invalidates cache without retry; next request reacquires", async (t) => {
  const h = harness(t);
  h.cantonStatus(401);
  const failed = await h.session();
  assert.equal(failed.statusCode, 503);
  assert.deepEqual(failed.json(), { reason: "shared_identity_unavailable" });
  assert.equal(h.calls(), 1);
  assert.equal(h.cantonRequests.length, 1);
  h.cantonStatus(200);
  assert.equal((await h.session()).statusCode, 200);
  assert.equal(h.calls(), 2);
});

test("Canton 403 remains insufficient service rights and does not evict token", async (t) => {
  const h = harness(t);
  h.cantonStatus(403);
  const failed = await h.session();
  assert.equal(failed.statusCode, 403);
  assert.deepEqual(failed.json(), { reason: "shared_identity_forbidden" });
  h.cantonStatus(200);
  assert.equal((await h.session()).statusCode, 200);
  assert.equal(h.calls(), 1);
});

test("transport tracks auth failures even when a route could otherwise return partial 200 data", async () => {
  for (const status of [401, 403]) {
    const provider = new ServiceTokenProvider(config(), {
      fetch: async (url) =>
        Response.json(String(url).includes("/.well-known/") ? metadata : validToken()),
    });
    const request = serviceRequest(provider, async () => ({ status, body: { error: secret } }));
    assert.deepEqual(await request.send({ method: "GET", path: "/v2/state/ledger-end" }), {
      status,
      body: null,
    });
    assert.deepEqual(request.failure(), {
      status: status === 401 ? 503 : 403,
      body: {
        reason: status === 401 ? "shared_identity_unavailable" : "shared_identity_forbidden",
      },
    });
  }
});

test("an error name survives the transport, and nothing else in the body does", async () => {
  // Four of the failures interpret.ts names arrive as a JsCantonError name rather than as a status code.
  // Dropping the whole body left it nothing to read them from, so under shared identity a pruned past, a
  // point not yet reached and a list past the node's limit each came back as node_error — "the node
  // refused" about a node that was answering. `code` is a fixed term from the node's own error taxonomy;
  // `cause` is prose the node writes around the values it was given, so that is still dropped.
  const provider = new ServiceTokenProvider(config(), {
    fetch: async (url) =>
      Response.json(String(url).includes("/.well-known/") ? metadata : validToken()),
  });
  const request = serviceRequest(provider, async () => ({
    status: 413,
    body: {
      code: "JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED",
      cause: "The number of matching elements (201) is greater than the node limit (200).",
      secret,
    },
  }));
  const response = await request.send({ method: "POST", path: "/v2/state/active-contracts" });
  assert.deepEqual(response, {
    status: 413,
    body: { code: "JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED" },
  });
  const serialized = JSON.stringify(response);
  assert.ok(!serialized.includes(secret), "no configured value leaves the transport");
  assert.ok(!serialized.includes("201"), "the node's prose does not leave the transport either");
  // What the name is for: the reason reaches the caller accurately instead of collapsing to node_error.
  const interpreted = interpretLedgerResponse(response.status, response.body);
  assert.ok(!interpreted.ok);
  assert.equal(interpreted.reason, "too_many_elements");
});

test("a body with no error name still arrives as null", async () => {
  const provider = new ServiceTokenProvider(config(), {
    fetch: async (url) =>
      Response.json(String(url).includes("/.well-known/") ? metadata : validToken()),
  });
  for (const body of [null, "not an object", { code: 7 }, { cause: secret }]) {
    const request = serviceRequest(provider, async () => ({ status: 500, body }));
    assert.deepEqual(await request.send({ method: "GET", path: "/v2/state/ledger-end" }), {
      status: 500,
      body: null,
    });
  }
});

test("a Canton transport exception cannot disclose secrets in API responses", async (t) => {
  const app = buildApp({
    ledgerAuth: config(),
    serviceTokenOptions: {
      fetch: async (url) =>
        Response.json(String(url).includes("/.well-known/") ? metadata : validToken()),
    },
    send: async () => {
      throw new Error(secret);
    },
  });
  t.after(() => app.close());
  const response = await app.inject({ url: "/api/session" });
  assert.equal(response.statusCode, 504);
  assert.deepEqual(response.json(), { reason: "unreachable" });
});

test("late invalidation of an older token does not evict a newer token; no unsolicited refresh retained", async () => {
  let now = 0;
  let calls = 0;
  const provider = new ServiceTokenProvider(config(), {
    now: () => now,
    fetch: async (url) =>
      Response.json(String(url).includes("/.well-known/") ? metadata : validToken(++calls)),
  });
  const old = await provider.get();
  now += 60_000;
  const current = await provider.get();
  provider.invalidate(old);
  assert.equal(await provider.get(), current);
  assert.deepEqual(Object.keys(current).sort(), ["usableUntil", "value"]);
  assert.equal(JSON.stringify(provider), "{}");
});

test("non-ledger paths and rejected methods do not acquire credentials", async (t) => {
  const h = harness(t);
  assert.equal((await h.app.inject({ url: "/" })).statusCode, 404);
  assert.equal((await h.app.inject({ url: "/api/unknown" })).statusCode, 404);
  assert.equal((await h.app.inject({ method: "POST", url: "/api/session" })).statusCode, 405);
  assert.equal(h.calls(), 0);
});

test("committed Browser config has no service credential fields", async () => {
  const browser = await readFile(
    new URL("../../../../apps/frontend/.env.example", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(browser, /SHARED_IDENTITY_CLIENT_SECRET\s*=/);
  assert.doesNotMatch(browser, /VITE_\w*SECRET\s*=/);
});
