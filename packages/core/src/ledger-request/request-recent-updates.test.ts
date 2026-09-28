import assert from "node:assert/strict";
import test from "node:test";
import { LEDGER_PAGE_SIZE } from "./paginate.ts";
import {
  callGetRecentUpdates,
  RECENT_UPDATES_LOOKBACK,
  RECENT_UPDATES_MAX_LOOKBACK,
  RECENT_UPDATES_TARGET,
  widenLookback,
} from "./request-recent-updates.ts";
import type { LedgerRequest, LedgerSend } from "./types.ts";

// **What these cover.** The schedule by which the window widens, read against a stubbed participant whose
// only knowledge is which offsets hold one of the viewer's transactions. The shapes are the ones
// paginate.test.ts uses for the same endpoint; nothing here depends on an event's content.

const FILTER = { parties: ["alice::1220ab"] } as const;

const transaction = (offset: number) => ({
  update: { Transaction: { value: { updateId: `u${offset}`, offset, events: [] } } },
});

type Range = { beginExclusive: number; endInclusive: number };

/**
 * A participant holding the viewer's transactions at exactly `offsets`, answering /v2/updates in pages the
 * way Canton does: ascending, at most one page's worth, and an empty page when the range is exhausted.
 * `prunedBefore` names the oldest offset it still retains; a range reaching past it is refused by name.
 */
function participant(offsets: readonly number[], prunedBefore = 0) {
  const asked: Range[] = [];
  const send: LedgerSend = async (request: LedgerRequest) => {
    const body = request.body as Range;
    if (body.beginExclusive < prunedBefore) {
      return {
        status: 400,
        body: { code: "PARTICIPANT_PRUNED_DATA_ACCESSED", cause: "pruned" },
      };
    }
    // The walk resumes from the last offset it saw, so the same range shows up once per page; only the
    // first request of a range is a step of the widening.
    const last = asked[asked.length - 1];
    if (last === undefined || last.endInclusive !== body.endInclusive) {
      asked.push({ beginExclusive: body.beginExclusive, endInclusive: body.endInclusive });
    }
    const page = offsets
      .filter((o) => o > body.beginExclusive && o <= body.endInclusive)
      .sort((a, b) => a - b)
      .slice(0, LEDGER_PAGE_SIZE)
      .map(transaction);
    return { status: 200, body: page };
  };
  return { send, asked };
}

const END = 1_000_000;
const offsetsOf = (value: { updates: unknown[] }) =>
  value.updates.map(
    (u) =>
      (u as { update: { Transaction: { value: { offset: number } } } }).update.Transaction.value
        .offset,
  );

test("a first window that already holds the target is not widened", async () => {
  const many = Array.from({ length: RECENT_UPDATES_TARGET }, (_, k) => END - k);
  const { send, asked } = participant(many);
  const result = await callGetRecentUpdates(send, FILTER, END);
  assert.ok(result.ok);
  assert.equal(result.value.beginExclusive, END - RECENT_UPDATES_LOOKBACK);
  assert.equal(asked.length, 1);
  assert.equal(result.value.updates.length, RECENT_UPDATES_TARGET);
});

test("a sparse ledger widens step by step, each step reading only the older part", async () => {
  // Three of the viewer's transactions, the newest 1,500 offsets back: not in the first 500, not in the
  // next 2,000... found at the second step, and the window keeps widening because three is under target.
  const { send, asked } = participant([END - 1_500, END - 6_000, END - 30_000]);
  const result = await callGetRecentUpdates(send, FILTER, END);
  assert.ok(result.ok);
  assert.deepEqual(asked, [
    { beginExclusive: END - 500, endInclusive: END },
    { beginExclusive: END - 2_000, endInclusive: END - 500 },
    { beginExclusive: END - 8_000, endInclusive: END - 2_000 },
    { beginExclusive: END - 32_000, endInclusive: END - 8_000 },
    { beginExclusive: END - 128_000, endInclusive: END - 32_000 },
  ]);
  assert.equal(result.value.beginExclusive, END - RECENT_UPDATES_MAX_LOOKBACK);
  // Ascending, as the node orders one range — the older steps are put in front.
  assert.deepEqual(offsetsOf(result.value), [END - 30_000, END - 6_000, END - 1_500]);
});

test("widening stops when the ledger's start is reached", async () => {
  const { send, asked } = participant([100], /* prunedBefore */ 0);
  const result = await callGetRecentUpdates(send, FILTER, 3_000);
  assert.ok(result.ok);
  assert.equal(result.value.beginExclusive, 0);
  assert.deepEqual(asked, [
    { beginExclusive: 2_500, endInclusive: 3_000 },
    { beginExclusive: 1_000, endInclusive: 2_500 },
    { beginExclusive: 0, endInclusive: 1_000 },
  ]);
  assert.deepEqual(offsetsOf(result.value), [100]);
});

test("a short ledger is read whole in one step, as before", async () => {
  const { send, asked } = participant([10, 20]);
  const result = await callGetRecentUpdates(send, FILTER, 263);
  assert.ok(result.ok);
  assert.equal(result.value.beginExclusive, 0);
  assert.deepEqual(asked, [{ beginExclusive: 0, endInclusive: 263 }]);
});

test("widening stops at the widest allowed window, and says where the window starts", async () => {
  const { send } = participant([]);
  const result = await callGetRecentUpdates(send, FILTER, END);
  assert.ok(result.ok);
  assert.equal(result.value.beginExclusive, END - RECENT_UPDATES_MAX_LOOKBACK);
  assert.deepEqual(result.value.updates, []);
});

test("a pruned past ends the widening and keeps the steps that were answered whole", async () => {
  // The participant retains nothing older than END - 5,000. The 8,000 step reaches past that and is refused;
  // the window stays at 2,000 and what it holds is returned, with the start it actually has.
  const { send, asked } = participant([END - 1_200], END - 5_000);
  const result = await callGetRecentUpdates(send, FILTER, END);
  assert.ok(result.ok);
  assert.equal(result.value.beginExclusive, END - 2_000);
  assert.deepEqual(offsetsOf(result.value), [END - 1_200]);
  assert.equal(asked.length, 2);
});

test("a first window that is already pruned fails by name, as any read of a pruned past does", async () => {
  const { send } = participant([], END);
  const result = await callGetRecentUpdates(send, FILTER, END);
  assert.ok(!result.ok);
  assert.equal(result.reason, "pruned");
});

test("any other failure of a wider step fails the whole read rather than returning a shorter window", async () => {
  let calls = 0;
  const send: LedgerSend = async () => {
    calls += 1;
    return calls === 1 ? { status: 200, body: [] } : { status: 500, body: { cause: "boom" } };
  };
  const result = await callGetRecentUpdates(send, FILTER, END);
  assert.ok(!result.ok);
  assert.equal(result.reason, "node_error");
});

test("the schedule: fourfold, capped, and null past the cap", () => {
  assert.equal(widenLookback(500), 2_000);
  assert.equal(widenLookback(2_000), 8_000);
  assert.equal(widenLookback(32_000), 128_000);
  assert.equal(widenLookback(128_000), null);
  assert.equal(widenLookback(100_000), 128_000);
});
