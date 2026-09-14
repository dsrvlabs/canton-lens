import assert from "node:assert/strict";
import { test } from "node:test";
import type { LedgerRequest, LedgerSend } from "@canton-lens/core";
import { logLedgerFailures } from "./ledger-failure-log.ts";

// A send that answers every request with one fixed status and body.
const answering = (status: number, body: unknown = null): LedgerSend => {
  return async () => ({ status, body });
};

const capture = () => {
  const lines: string[] = [];
  return { lines, log: (line: string) => lines.push(line) };
};

const post = (path: string): LedgerRequest => ({ method: "POST", path });

test("a ledger 400 is logged with the path, the reason and the detail", async () => {
  const { lines, log } = capture();
  await logLedgerFailures(answering(400), log)(post("/v2/state/active-contracts"));
  assert.deepEqual(lines, [
    "[explorer-api] ledger POST /v2/state/active-contracts — node_error (ledger responded 400)",
  ]);
});

test("a send that never arrived is logged by path and reason, and the thrown message is not written down", async () => {
  const { lines, log } = capture();
  // shared-identity.test.ts models a transport exception whose message is the configured client secret.
  const throwing: LedgerSend = async () => {
    throw new Error("synthetic: secret+&");
  };
  await assert.rejects(
    () => logLedgerFailures(throwing, log)(post("/v2/state/active-contracts")),
    /synthetic/,
    "the throw still travels upward — naming it unreachable stays the router's job",
  );
  assert.deepEqual(lines, ["[explorer-api] ledger POST /v2/state/active-contracts — unreachable"]);
});

test("a list the node will not serve in one response names the path whose limit to raise", async () => {
  const { lines, log } = capture();
  // The node's own name for it. The list paths ask in parts of LEDGER_PAGE_SIZE, so a node still answering
  // this is configured below that — a setting only the operator can reach, from a line only they read.
  await logLedgerFailures(
    answering(413, { code: "JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED" }),
    log,
  )(post("/v2/state/active-contracts"));
  assert.deepEqual(lines, [
    "[explorer-api] ledger POST /v2/state/active-contracts — too_many_elements " +
      "(ledger responded 413 with a JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED error code)",
  ]);
});

test("routine outcomes are not logged — this is not a request logger", async () => {
  for (const [status, body] of [
    [200, { ok: true }],
    [401, null],
    [403, null],
    [404, null],
    [400, { code: "PRUNED_DATA_ACCESSED" }],
    [400, { code: "OFFSET_AFTER_LEDGER_END" }],
    [404, { code: "UPDATE_NOT_FOUND" }],
  ] as [number, unknown][]) {
    const { lines, log } = capture();
    await logLedgerFailures(answering(status, body), log)(post("/v2/updates/update-by-id"));
    assert.deepEqual(lines, [], `${status} ${JSON.stringify(body)}`);
  }
});

test("the ledger user id is not written to the log", async () => {
  const { lines, log } = capture();
  await logLedgerFailures(
    answering(500),
    log,
  )({ method: "GET", path: "/v2/users/alice%3A%3A1220ab/rights" });
  assert.deepEqual(lines, [
    "[explorer-api] ledger GET /v2/users/{userId}/rights — node_error (ledger responded 500)",
  ]);
});

test("the response travels through unchanged, and the credential is never read", async () => {
  const { lines, log } = capture();
  const seen: unknown[] = [];
  const send: LedgerSend = async (request) => {
    seen.push(request);
    return { status: 400, body: { secret: "the raw ledger body" } };
  };
  const response = await logLedgerFailures(
    send,
    log,
  )({
    ...post("/v2/state/active-contracts"),
    // The field withAuth lays on. It reaches the real transport untouched and must not reach the log.
    authorization: "Bearer a-real-token",
  } as LedgerRequest);

  assert.deepEqual(response, { status: 400, body: { secret: "the raw ledger body" } });
  assert.deepEqual(seen, [
    { method: "POST", path: "/v2/state/active-contracts", authorization: "Bearer a-real-token" },
  ]);
  for (const line of lines) {
    assert.ok(!line.includes("a-real-token"), line);
    assert.ok(!line.includes("the raw ledger body"), line);
  }
});
