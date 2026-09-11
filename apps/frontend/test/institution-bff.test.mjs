import assert from "node:assert/strict";
import { test } from "node:test";
import { configureAuth } from "../src/auth/runtime.ts";
import { buildApp } from "@canton-lens/backend/build-app";

test("institution-bff profile preserves same-origin requests and server-provided login recovery", async (t) => {
  globalThis.location = new URL("https://explorer.example/explorer/");
  t.after(() => { delete globalThis.location; });
  assert.equal(configureAuth({ mode: "institution-bff" }), null);
  const requests = [];
  let status = 200;
  t.mock.method(globalThis, "fetch", async (...args) => {
    requests.push(args);
    return Response.json(status === 200 ? { ok: true } : { login: "/login" }, { status });
  });
  const { apiResponse, SignInRequiredError } = await import("../src/api/client.ts");
  assert.deepEqual((await apiResponse("/api/session")).body, { ok: true });
  assert.deepEqual(requests[0], ["/explorer/api/session"]);
  status = 401;
  await assert.rejects(apiResponse("/api/session"), (error) => {
    assert.ok(error instanceof SignInRequiredError);
    assert.equal(error.entryUrl, "https://explorer.example/login");
    return true;
  });
});

test("institution-bff remains a per-request caller-bearer contract without a supplied BFF implementation", async (t) => {
  globalThis.location = new URL("https://institution.example/explorer/");
  t.after(() => { delete globalThis.location; });
  configureAuth({ mode: "institution-bff" });
  let user = "alice";
  let cantonStatus = 200;
  const calls = [];
  const app = buildApp({
    ledgerAuth: { mode: "caller-bearer" },
    send: async (request) => {
      calls.push(request.authorization);
      assert.equal(request.authorization, `Bearer synthetic-${user}`);
      return { status: cantonStatus, body: request.path.endsWith("/rights")
        ? { rights: [] } : { user: { id: user, primaryParty: "" } } };
    },
  });
  t.after(() => app.close());
  // Transport double for an institution-owned boundary, not an executable BFF/session implementation.
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(new Headers(init?.headers).has("authorization"), false);
    const response = await app.inject({ url: path.replace("/explorer", ""), headers: { authorization: `Bearer synthetic-${user}` } });
    assert.ok(!response.body.includes("synthetic-"));
    return new Response(response.body, { status: response.statusCode, headers: response.headers });
  });
  const { apiResponse, SignInRequiredError } = await import("../src/api/client.ts");
  for (user of ["alice", "bob", "alice"]) {
    assert.equal((await apiResponse("/api/session")).body.userId, user);
  }
  assert.ok(calls.includes("Bearer synthetic-alice") && calls.includes("Bearer synthetic-bob"));
  cantonStatus = 403;
  await assert.rejects(apiResponse("/api/session"), (error) => !(error instanceof SignInRequiredError));
  const before = calls.length;
  assert.equal((await app.inject({ url: "/openapi.json" })).statusCode, 200);
  for (const url of ["/login", "/logout", "/oauth/callback", "/health"]) {
    assert.equal((await app.inject({ url })).statusCode, 404);
  }
  assert.equal(calls.length, before, "OpenAPI and unknown auth paths do not contact Canton");
});
