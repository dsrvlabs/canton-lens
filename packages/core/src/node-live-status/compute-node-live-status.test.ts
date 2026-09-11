import assert from "node:assert/strict";
import { test } from "node:test";
import { computeInstanceLedgerEndProgress } from "./compute-node-live-status.ts";

test("a rising offset gives advanced and a delta", () => {
  const result = computeInstanceLedgerEndProgress(
    { status: "ok", offset: 100 },
    { status: "ok", offset: 150 },
  );
  assert.deepEqual(result, { case: "advanced", delta: 50 });
});

test("an unchanged offset gives stalled", () => {
  const result = computeInstanceLedgerEndProgress(
    { status: "ok", offset: 100 },
    { status: "ok", offset: 100 },
  );
  assert.deepEqual(result, { case: "stalled" });
});

test("a falling offset gives regressed and a negative delta", () => {
  const result = computeInstanceLedgerEndProgress(
    { status: "ok", offset: 150 },
    { status: "ok", offset: 100 },
  );
  assert.deepEqual(result, { case: "regressed", delta: -50 });
});

test("an unavailable prior reading gives prior-unavailable (it is not flattened to 0)", () => {
  const result = computeInstanceLedgerEndProgress(
    { status: "unavailable", reason: "unreachable" },
    { status: "ok", offset: 100 },
  );
  assert.deepEqual(result, { case: "prior-unavailable" });
});

test("an unavailable current reading gives current-unavailable", () => {
  const result = computeInstanceLedgerEndProgress(
    { status: "ok", offset: 100 },
    { status: "unavailable", reason: "node_error" },
  );
  assert.deepEqual(result, { case: "current-unavailable" });
});

test("both unavailable gives both-unavailable", () => {
  const result = computeInstanceLedgerEndProgress(
    { status: "unavailable", reason: "forbidden" },
    { status: "unavailable", reason: "unauthenticated" },
  );
  assert.deepEqual(result, { case: "both-unavailable" });
});
