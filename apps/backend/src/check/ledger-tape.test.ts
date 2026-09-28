// **The one difference the tape excuses, and everything it must not.**
//
// A question is supposed to have one answer, and `dedupeTape` says so when it does not. There is exactly one
// exception: when the node reports a failure it names *that request* inside it, so two calls never come back
// byte-identical once anything in the answer failed — and the seed holds a contract whose standard view
// cannot be computed on purpose, because it is the only way the `problems` list is ever reached.
//
// The exception is worth a test of its own because it is the only place in the recording where "these two
// answers are the same" has been weakened, and a weakening nobody is watching gets wider.
import assert from "node:assert/strict";
import test from "node:test";
import { dedupeTape, type TapeEntry } from "./ledger-tape.ts";

const asked = (response: unknown): TapeEntry => ({
  who: "alice",
  method: "POST",
  path: "/v2/state/active-contracts",
  body: { filter: {} },
  status: 200,
  response,
});

const failing = (message: string, detail: string, extra: Record<string, unknown> = {}) =>
  asked({
    rows: [{ viewStatus: { code: 9, message, details: [{ value: detail }], ...extra } }],
  });

test("the same failure, worded for two different requests, is one answer", () => {
  const { conflicts, entries } = dedupeTape([
    failing("DAML_FAILURE(9,9da4ed2a): the view cannot be computed", "dGlkOjlkYTRlZDJh"),
    failing("DAML_FAILURE(9,7bc1f004): the view cannot be computed", "dGlkOjdiYzFmMDA0"),
  ]);
  assert.deepEqual(conflicts, []);
  // **The first one, unedited.** Nothing is rewritten to make the recording agree with itself — what goes in
  // the file is an answer the node actually gave.
  assert.equal(entries.length, 1);
  assert.match(JSON.stringify(entries[0]), /9da4ed2a/);
});

test("a failure that changed category is not excused", () => {
  const { conflicts } = dedupeTape([
    failing("DAML_FAILURE(9,a): the view cannot be computed", "x"),
    asked({ rows: [{ viewStatus: { code: 7, message: "permission denied", details: [] } }] }),
  ]);
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0]?.where ?? "", /code/);
});

test("a field beside the failure is not dropped along with its wording", () => {
  // The first version replaced the whole status object, so any sibling — one a future Canton adds — vanished
  // from the comparison with it (2026-09-18 codex).
  const { conflicts } = dedupeTape([
    failing("DAML_FAILURE(9,a): x", "x", { retryable: true }),
    failing("DAML_FAILURE(9,b): x", "x", { retryable: false }),
  ]);
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0]?.where ?? "", /retryable/);
});

test("a failure that appeared, or went away, is not excused", () => {
  const { conflicts } = dedupeTape([asked({ rows: [{}] }), failing("DAML_FAILURE(9,a): x", "x")]);
  assert.equal(conflicts.length, 1);
});

test("an answer that simply differs is a conflict, and it says where", () => {
  const { conflicts } = dedupeTape([asked({ rows: [1, 2, 3] }), asked({ rows: [1, 2] })]);
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0]?.where ?? "", /held 3 then 2/);
});
