import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { readAuthConfig } from "../src/auth/config.ts";
import { configureAuth, getBrowserOidcAuth, isSharedIdentity } from "../src/auth/runtime.ts";
import { buildApp } from "@canton-lens/backend/build-app";

test("shared-identity needs no Browser OIDC config, window, storage or login transaction", () => {
  const config = readAuthConfig({ VITE_AUTH_MODE: "shared-identity" }, "https://explorer.example/");
  assert.deepEqual(config, { mode: "shared-identity" });
  assert.equal(configureAuth(config), null);
  assert.equal(getBrowserOidcAuth(), null);
  assert.equal(isSharedIdentity(), true);
});

test("shared-identity Browser API requests have no Bearer, no OIDC or login recovery, including erroneous 401", async (t) => {
  globalThis.location = new URL("https://explorer.example/explorer/");
  t.after(() => { delete globalThis.location; });
  configureAuth({ mode: "shared-identity" });
  let status = 200;
  const requests = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    requests.push({ path, init });
    return Response.json({ login: "/login", entryUrl: "/login", reason: status === 403 ? "shared_identity_forbidden" : "shared_identity_unavailable" }, { status });
  });
  const { apiResponse, SignInRequiredError } = await import("../src/api/client.ts");
  await apiResponse("/api/session");
  for (status of [401, 503, 403]) {
    await assert.rejects(apiResponse("/api/session"), (error) => {
      assert.ok(!(error instanceof SignInRequiredError));
      assert.match(error.message, /operator/);
      assert.equal(error.entryUrl, undefined);
      return true;
    });
  }
  for (const request of requests) {
    assert.equal(request.path, "/explorer/api/session");
    assert.equal(new Headers(request.init.headers).get("authorization"), null);
    assert.equal(request.init.credentials, "same-origin", "operator gateway cookies may remain same-origin");
    assert.equal(request.init.redirect, "error");
    assert.equal(request.init.cache, "no-store");
  }
});

test("Browser -> actual Backend service credential boundary -> Canton; operational failure is not user login", async (t) => {
  globalThis.location = new URL("https://explorer.example/explorer/");
  t.after(() => { delete globalThis.location; });
  configureAuth({ mode: "shared-identity" });
  let fail = false;
  const app = buildApp({
    basePath: "/explorer",
    ledgerAuth: { mode: "shared-identity", issuer: "https://idp.example/realm", clientId: "service", clientSecret: "backend-only-synthetic", scopes: "ledger.read" },
    serviceTokenOptions: { fetch: async (url) => Response.json(String(url).includes("/.well-known/")
      ? { issuer: "https://idp.example/realm", token_endpoint: "https://idp.example/token" }
      : { access_token: "backend-only-token", token_type: "Bearer", expires_in: 60 }) },
    send: async (request) => {
      assert.equal(request.authorization, "Bearer backend-only-token");
      return { status: fail ? 401 : 200, body: request.path.endsWith("/rights") ? { rights: [] } : { user: { id: "shared-service", primaryParty: "shared-party" } } };
    },
  });
  t.after(() => app.close());
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(new Headers(init.headers).has("authorization"), false);
    const response = await app.inject({ url: path });
    assert.ok(!response.body.includes("backend-only"));
    return new Response(response.body, { status: response.statusCode, headers: response.headers });
  });
  const { apiResponse, SignInRequiredError } = await import("../src/api/client.ts");
  assert.equal((await apiResponse("/api/session")).body.userId, "shared-service");
  fail = true;
  await assert.rejects(apiResponse("/api/session"), (error) => !(error instanceof SignInRequiredError) && /operator/.test(error.message));
});

test("Browser sources do not import Backend credentials; the logout guard remains explicit", async () => {
  const root = new URL("../src/", import.meta.url);
  for (const path of await readdir(root, { recursive: true })) {
    if (!/\.tsx?$/.test(path)) continue;
    const source = await readFile(new URL(path, root), "utf8");
    assert.doesNotMatch(source, /SHARED_IDENTITY_CLIENT_SECRET|backend\/api\/src\/auth/);
  }
  const header = await readFile(new URL("shell/Header.tsx", root), "utf8");
  assert.match(header, /!isSharedIdentity\(\) && logoutUrl/);
});
