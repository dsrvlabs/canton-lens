import assert from "node:assert/strict";
import test from "node:test";
import { interpretLedgerResponse } from "./interpret.ts";

test("PRUNED in the error body's code is pruned regardless of the status code — a different name from “does not exist”", () => {
  const body = {
    code: "PARTICIPANT_PRUNED_DATA_ACCESSED",
    cause: "…",
    context: {},
    errorCategory: 9,
  };
  assert.equal(interpretLedgerResponse(400, body).ok, false);
  const r = interpretLedgerResponse(400, body);
  assert.ok(!r.ok);
  assert.equal(r.reason, "pruned");
  assert.ok(!(r.detail ?? "").includes("…"), "the body text is not put into detail");
  // Even at 404, a code of PRUNED wins
  const r2 = interpretLedgerResponse(404, body);
  assert.ok(!r2.ok);
  assert.equal(r2.reason, "pruned");
  // A 400 with a different code stays node_error, as now
  const r3 = interpretLedgerResponse(400, { code: "INVALID_ARGUMENT" });
  assert.ok(!r3.ok);
  assert.equal(r3.reason, "node_error");
});

test("OFFSET_AFTER_LEDGER_END in the code is offset_after_ledger_end — “not yet”", () => {
  // The real shape a real node gave: "active_at_offset offset (171) is after ledger end (170)".
  const body = { code: "OFFSET_AFTER_LEDGER_END", cause: "active_at_offset offset (171) is …" };
  for (const status of [400, 404, 500]) {
    const r = interpretLedgerResponse(status, body);
    assert.ok(!r.ok);
    assert.equal(
      r.reason,
      "offset_after_ledger_end",
      `must hold regardless of status code ${status}`,
    );
  }
  const one = interpretLedgerResponse(400, body);
  assert.ok(!one.ok);
  assert.ok(!(one.detail ?? "").includes("171"), "the body text is not put into detail");
});

test("UPDATE_NOT_FOUND in the code is not_found — not a server fault (502)", () => {
  // The real one: "Update not found, or not visible." The status code is not 404, so a status-only mapping
  // would call it node_error.
  const body = { code: "UPDATE_NOT_FOUND", cause: "Update not found, or not visible." };
  const r = interpretLedgerResponse(400, body);
  assert.ok(!r.ok);
  assert.equal(r.reason, "not_found");
});

test("the name must match **exactly** — matching by substring drags in other names too", () => {
  // The ledger answers PACKAGE_NAMES_NOT_FOUND with status 404, so it becomes not_found by that route.
  // Widening this on the name alone could move “a node configuration problem” to 404 too, so it is kept narrow.
  // Written with `includes`, all three below would pass.
  for (const code of [
    "SOMETHING_ELSE_NOT_FOUND",
    "UPDATE_NOT_FOUNDISH",
    "X_UPDATE_NOT_FOUND_Y",
    "PREFIX_UPDATE_NOT_FOUND",
  ]) {
    const r = interpretLedgerResponse(400, { code });
    assert.ok(!r.ok);
    assert.equal(r.reason, "node_error", `${code} is not UPDATE_NOT_FOUND`);
  }
  // For the same reason, the offset side is also exact-match only.
  const off = interpretLedgerResponse(400, { code: "X_OFFSET_AFTER_LEDGER_END" });
  assert.ok(!off.ok);
  assert.equal(off.reason, "node_error");
});

test("only PRUNED is matched by substring — because the real name is PARTICIPANT_PRUNED_DATA_ACCESSED", () => {
  // `includes` here alone is deliberate. A family of names with PRUNED in the middle really exists.
  const r = interpretLedgerResponse(400, { code: "PARTICIPANT_PRUNED_DATA_ACCESSED" });
  assert.ok(!r.ok);
  assert.equal(r.reason, "pruned");
});

test("with no name the status code decides — everything outside 200·401·403·404 is node_error", () => {
  assert.deepEqual(interpretLedgerResponse(200, { a: 1 }), { ok: true, value: { a: 1 } });
  for (const [status, reason] of [
    [401, "unauthenticated"],
    [403, "forbidden"],
    [404, "not_found"],
  ] as const) {
    const r = interpretLedgerResponse(status, null);
    assert.ok(!r.ok);
    assert.equal(r.reason, reason);
  }
  for (const status of [400, 429, 500, 503]) {
    const r = interpretLedgerResponse(status, null);
    assert.ok(!r.ok);
    assert.equal(r.reason, "node_error", `${status} must be node_error`);
  }
});

test("JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED is too_many_elements — the node did not refuse, the list was too long", () => {
  // The real shape a real participant gave, replayed against Canton 3.5.15 with a live token:
  //   413 {"code":"JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED",
  //        "cause":"The number of matching elements (201) is greater than the node limit (200)."}
  // 413 is not among the mapped status codes, so without the name this reads as node_error (502) and the
  // operator is told “the node refused” when nothing is broken.
  const body = {
    code: "JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED",
    cause: "The number of matching elements (201) is greater than the node limit (200).",
  };
  for (const status of [413, 400, 500]) {
    const r = interpretLedgerResponse(status, body);
    assert.ok(!r.ok);
    assert.equal(r.reason, "too_many_elements", `must hold regardless of status code ${status}`);
  }
  const one = interpretLedgerResponse(413, body);
  assert.ok(!one.ok);
  assert.ok(!(one.detail ?? "").includes("201"), "the body text is not put into detail");
  // Without the name a 413 is still node_error — the status alone carries no meaning here, and the node's
  // own OpenAPI declares 413 on no path at all.
  const bare = interpretLedgerResponse(413, null);
  assert.ok(!bare.ok);
  assert.equal(bare.reason, "node_error");
});

test("the list-limit name is matched **exactly** too", () => {
  for (const code of [
    "JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED_AGAIN",
    "X_JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED",
    "JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER",
  ]) {
    const r = interpretLedgerResponse(413, { code });
    assert.ok(!r.ok);
    assert.equal(r.reason, "node_error", `${code} is not the list-limit name`);
  }
});

test("a body that arrives as null because it was not JSON does not throw", () => {
  // serve.mjs turns a JSON.parse failure into body:null (since the false unreachable was removed).
  const r = interpretLedgerResponse(400, null);
  assert.ok(!r.ok);
  assert.equal(r.reason, "node_error");
});
