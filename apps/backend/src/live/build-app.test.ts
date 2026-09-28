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

test("a ledger failure is written to the log, and the response body still says only the reason", async (t) => {
  const lines: string[] = [];
  const app = buildApp({
    // The participant rejects the request. Which call it was and what it answered leaves the process
    // only through the log; the caller is told node_error and nothing else.
    send: async () => ({ status: 400, body: { cause: "a body the caller must not receive" } }),
    ledgerAuth: { mode: "caller-bearer" },
    log: (line) => lines.push(line),
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/api/contracts",
    headers: { authorization: "Bearer a-real-token" },
  });

  assert.equal(response.statusCode, 502);
  assert.deepEqual(response.json(), { reason: "node_error" });
  assert.deepEqual(lines, [
    "[explorer-api] ledger GET /v2/state/ledger-end — node_error (ledger responded 400)",
  ]);
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

// /api/node embeds a ledger failure inside its 200, so a `send` that throws still reaches the point where
// the response is stamped with the clock — and a clock that throws is the one exception `handle` does not
// convert into a named ledger failure. That makes it the shortest route to an unexpected 500.
test("an unexpected failure answers 500 with the reason name only, never the exception message", async (t) => {
  const stderr: string[] = [];
  const original = console.error;
  console.error = (line) => stderr.push(String(line));
  t.after(() => {
    console.error = original;
  });
  const app = buildApp({
    send,
    ledgerAuth: { mode: "caller-bearer" },
    now: () => {
      throw new Error("clock failure with an internal path /srv/explorer/clock.mjs");
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/api/node?currentObservedAtMs=1",
    headers: { authorization: "Bearer t" },
  });

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { reason: "server_error" });
  assert.ok(
    !response.body.includes("clock failure"),
    "the exception message must not leave the process",
  );
  assert.ok(
    stderr.some((line) => line.includes("server_error") && line.includes("clock failure")),
    "the operator still reads the message on stderr",
  );
});
