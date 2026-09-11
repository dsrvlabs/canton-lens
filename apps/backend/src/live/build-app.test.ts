import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "./build-app.mjs";

const send = async () => {
  throw new Error("the unauthenticated request must not reach the ledger");
};

test("an unauthenticated response includes the configured public entry URL", async (t) => {
  const app = buildApp({
    send,
    ledgerAuth: { mode: "caller-bearer" },
    publicEntryUrl: "https://console.example/explorer/",
  });
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/api/home" });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), {
    reason: "unauthenticated",
    entryUrl: "https://console.example/explorer/",
  });
});

test("an unauthenticated response does not invent an entry URL", async (t) => {
  const app = buildApp({ send, ledgerAuth: { mode: "caller-bearer" } });
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/api/home" });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { reason: "unauthenticated" });
});

test("the API server never serves frontend files", async (t) => {
  const app = buildApp({ send, ledgerAuth: { mode: "caller-bearer" } });
  t.after(() => app.close());

  for (const url of ["/", "/index.html", "/assets/app.js"]) {
    const response = await app.inject({ method: "GET", url });
    assert.equal(response.statusCode, 404, url);
    assert.deepEqual(response.json(), { reason: "no_such_route" });
  }
});
