import assert from "node:assert/strict";
import { test } from "node:test";
import { ledgerFailureToHttp } from "./ledger-failure-to-http.ts";

test("four reasons each map to a distinct status code and body (unreachable is below, separately)", () => {
  assert.deepEqual(ledgerFailureToHttp("unauthenticated"), {
    status: 401,
    body: { reason: "unauthenticated" },
  });
  assert.deepEqual(ledgerFailureToHttp("forbidden"), {
    status: 403,
    body: { reason: "forbidden" },
  });
  assert.deepEqual(ledgerFailureToHttp("not_found"), {
    status: 404,
    body: { reason: "not_found" },
  });
  assert.deepEqual(ledgerFailureToHttp("node_error"), {
    status: 502,
    body: { reason: "node_error" },
  });
});

test("the query-failure path: unreachable maps to 504", () => {
  assert.deepEqual(ledgerFailureToHttp("unreachable"), {
    status: 504,
    body: { reason: "unreachable" },
  });
});

test("offset_after_ledger_end is 400 — a point that has not arrived yet is something the caller can fix", () => {
  assert.deepEqual(ledgerFailureToHttp("offset_after_ledger_end"), {
    status: 400,
    body: { reason: "offset_after_ledger_end" },
  });
});

test("pruned is 410 Gone — “it existed but is not retained” differs from “it does not exist” (404)", () => {
  assert.deepEqual(ledgerFailureToHttp("pruned"), {
    status: 410,
    body: { reason: "pruned" },
  });
});

test("all seven reasons currently have distinct status codes — overlapping, the screen cannot tell them apart by status", () => {
  // If an overlap appears this test breaks. At that point, what the screen uses to tell them apart has to be decided again.
  const all = [
    "unauthenticated",
    "forbidden",
    "not_found",
    "node_error",
    "unreachable",
    "offset_after_ledger_end",
    "pruned",
  ] as const;
  const codes = all.map((r) => ledgerFailureToHttp(r).status);
  assert.deepEqual(codes, [401, 403, 404, 502, 504, 400, 410]);
  assert.equal(
    new Set(codes).size,
    all.length,
    "the seven currently all have distinct status codes",
  );
  // And the reason name is always carried in the body verbatim — the screen picks its wording from it.
  for (const reason of all) assert.equal(ledgerFailureToHttp(reason).body.reason, reason);
});
