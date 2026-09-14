import assert from "node:assert/strict";
import test from "node:test";
import { LEDGER_MAX_ELEMENTS, LEDGER_MAX_PAGES, LEDGER_PAGE_SIZE } from "./paginate.ts";
import { callGetActiveContracts } from "./request-active-contracts.ts";
import { callGetUpdates } from "./request-updates.ts";
import type { LedgerRequest, LedgerSend } from "./types.ts";

// **What these cover and what they cannot.** The local development stack holds 37 active contracts and 44
// updates in the recent window — under any node's list limit — so an over-limit participant cannot be stood
// up here. The node's answers are therefore stubbed: the 413 body is the one a real participant gave, and the
// page shapes are the ones Canton 3.5.15 gave when the same walk was run against it with `limit` set small.

const PARTIES = ["alice::1220ab"];
const OFFSET = 158;

type Answer = { status: number; body: unknown };

function recorder(answers: readonly Answer[]): {
  send: LedgerSend;
  sent: LedgerRequest[];
} {
  const sent: LedgerRequest[] = [];
  let i = 0;
  const send: LedgerSend = async (request) => {
    sent.push(request);
    const answer = answers[i];
    i += 1;
    if (answer === undefined) throw new Error(`no stubbed answer for request ${i}`);
    return answer;
  };
  return { send, sent };
}

// One element of an active-contracts page, as Canton 3.5 shapes it: a token on every element.
const acsElement = (contractId: string, token: string) => ({
  contractEntry: { JsActiveContract: { createdEvent: { contractId } } },
  streamContinuationToken: token,
});

const acsPage = (from: number, count: number) =>
  Array.from({ length: count }, (_, k) => acsElement(`c${from + k}`, `tok-${from + k}`));

const updateElement = (offset: number) => ({
  update: { Transaction: { value: { updateId: `u${offset}`, offset, events: [] } } },
});

const LIST_LIMIT_413: Answer = {
  status: 413,
  body: {
    code: "JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED",
    cause: "The number of matching elements (201) is greater than the node limit (200).",
  },
};

test("active contracts: every request asks for a bounded page", async () => {
  const { send, sent } = recorder([{ status: 200, body: [] }]);
  await callGetActiveContracts(send, PARTIES, OFFSET);
  assert.equal(sent[0]?.path, `/v2/state/active-contracts?limit=${LEDGER_PAGE_SIZE}`);
  // Without the limit the node returns the whole snapshot and answers 413 the moment it is over the limit.
  assert.ok(sent[0]?.path.includes("limit="));
});

test("active contracts: a continuation token makes a second request carrying it, and the pages are combined", async () => {
  const first = acsPage(0, 3);
  const second = acsPage(3, 2);
  const { send, sent } = recorder([
    { status: 200, body: first },
    { status: 200, body: second },
    { status: 200, body: [] },
  ]);
  const result = await callGetActiveContracts(send, PARTIES, OFFSET);
  assert.ok(result.ok);
  assert.equal((result.value as unknown[]).length, 5);
  assert.deepEqual(result.value, [...first, ...second]);

  assert.equal(sent.length, 3, "the empty page is what ends the walk");
  const bodies = sent.map((r) => r.body as Record<string, unknown>);
  assert.equal(bodies[0]?.streamContinuationToken, undefined, "the first page asks from the start");
  // The token of the **last** element of a page is the position the next page resumes from.
  assert.equal(bodies[1]?.streamContinuationToken, "tok-2");
  assert.equal(bodies[2]?.streamContinuationToken, "tok-4");
  // The node's own document: a continuation is only valid at the same activeAtOffset. It must not drift.
  for (const body of bodies) assert.equal(body?.activeAtOffset, OFFSET);
});

test("active contracts: the terminating page ends the loop — nothing is asked after it", async () => {
  const { send, sent } = recorder([
    { status: 200, body: acsPage(0, 2) },
    { status: 200, body: [] },
    { status: 200, body: acsPage(2, 2) },
  ]);
  const result = await callGetActiveContracts(send, PARTIES, OFFSET);
  assert.ok(result.ok);
  assert.equal((result.value as unknown[]).length, 2);
  assert.equal(sent.length, 2, "the third answer must never be asked for");
});

test("active contracts: a page that fails halfway fails the whole call — no half snapshot", async () => {
  const { send, sent } = recorder([{ status: 200, body: acsPage(0, 2) }, LIST_LIMIT_413]);
  const result = await callGetActiveContracts(send, PARTIES, OFFSET);
  assert.ok(!result.ok);
  assert.equal(result.reason, "too_many_elements");
  assert.equal(sent.length, 2);
  // There is no `value` on a failure — the two elements already collected are dropped rather than
  // handed over as if they were the snapshot.
  assert.equal((result as { value?: unknown }).value, undefined);
});

test("active contracts: an authentication failure on a later page is reported as itself", async () => {
  const { send } = recorder([
    { status: 200, body: acsPage(0, 2) },
    { status: 401, body: null },
  ]);
  const result = await callGetActiveContracts(send, PARTIES, OFFSET);
  assert.ok(!result.ok);
  assert.equal(result.reason, "unauthenticated");
});

test("active contracts: a page with content but no position to continue from is a shape failure, not the end", async () => {
  const { send } = recorder([
    { status: 200, body: [{ contractEntry: { JsActiveContract: { createdEvent: {} } } }] },
  ]);
  const result = await callGetActiveContracts(send, PARTIES, OFFSET);
  assert.ok(!result.ok);
  // Reading it as the end would serve a possibly-truncated snapshot as a whole one.
  assert.equal(result.reason, "node_error");
});

test("active contracts: a response that is not a list is a shape failure", async () => {
  const { send } = recorder([{ status: 200, body: { contracts: [] } }]);
  const result = await callGetActiveContracts(send, PARTIES, OFFSET);
  assert.ok(!result.ok);
  assert.equal(result.reason, "node_error");
});

test("active contracts: the send function throwing is unreachable, as before", async () => {
  const send: LedgerSend = async () => {
    throw new Error("connect ECONNREFUSED");
  };
  const result = await callGetActiveContracts(send, PARTIES, OFFSET);
  assert.ok(!result.ok);
  assert.equal(result.reason, "unreachable");
});

test("the element bound stops the walk with a name, not with a short list", async () => {
  const answers: Answer[] = [];
  const pages = Math.floor(LEDGER_MAX_ELEMENTS / LEDGER_PAGE_SIZE) + 1;
  for (let p = 0; p < pages; p++) {
    answers.push({ status: 200, body: acsPage(p * LEDGER_PAGE_SIZE, LEDGER_PAGE_SIZE) });
  }
  const { send } = recorder(answers);
  const result = await callGetActiveContracts(send, PARTIES, OFFSET);
  assert.ok(!result.ok);
  assert.equal(result.reason, "too_many_elements");
});

test("the page bound stops the walk even when a node hands back tiny pages", async () => {
  // A node whose own limit is 1 would otherwise be walked forever; the element bound alone would allow
  // LEDGER_MAX_ELEMENTS round trips.
  const answers: Answer[] = Array.from({ length: LEDGER_MAX_PAGES + 1 }, (_, k) => ({
    status: 200,
    body: acsPage(k, 1),
  }));
  const { send, sent } = recorder(answers);
  const result = await callGetActiveContracts(send, PARTIES, OFFSET);
  assert.ok(!result.ok);
  assert.equal(result.reason, "too_many_elements");
  assert.equal(sent.length, LEDGER_MAX_PAGES);
});

test("updates: the next page begins exclusively after the last offset seen, within the same window", async () => {
  const first = [updateElement(24), updateElement(27), updateElement(30)];
  const second = [updateElement(36), updateElement(39)];
  const { send, sent } = recorder([
    { status: 200, body: first },
    { status: 200, body: second },
    { status: 200, body: [] },
  ]);
  const result = await callGetUpdates(send, PARTIES, 10, 100);
  assert.ok(result.ok);
  assert.deepEqual(result.value, [...first, ...second]);

  assert.equal(sent.length, 3);
  assert.equal(sent[0]?.path, `/v2/updates?limit=${LEDGER_PAGE_SIZE}`);
  const bodies = sent.map((r) => r.body as Record<string, unknown>);
  assert.equal(bodies[0]?.beginExclusive, 10);
  assert.equal(bodies[1]?.beginExclusive, 30, "resumes after the last offset of the first page");
  assert.equal(bodies[2]?.beginExclusive, 39);
  // The window's far end never moves — otherwise the walk would chase a ledger that keeps growing.
  for (const body of bodies) assert.equal(body?.endInclusive, 100);
});

test("updates: the list limit is reported by its own name here too", async () => {
  const { send } = recorder([LIST_LIMIT_413]);
  const result = await callGetUpdates(send, PARTIES, 10, 100);
  assert.ok(!result.ok);
  assert.equal(result.reason, "too_many_elements");
});

test("updates: the offset is read from whichever update shape arrives", async () => {
  // The node's schema marks offset required on all four shapes of an update.
  const mixed = [
    { update: { Reassignment: { value: { offset: 51 } } } },
    { update: { TopologyTransaction: { value: { offset: 54 } } } },
    { update: { OffsetCheckpoint: { value: { offset: 57 } } } },
  ];
  const { send, sent } = recorder([
    { status: 200, body: mixed },
    { status: 200, body: [] },
  ]);
  const result = await callGetUpdates(send, PARTIES, 10, 100);
  assert.ok(result.ok);
  assert.equal((sent[1]?.body as Record<string, unknown> | undefined)?.beginExclusive, 57);
});

test("updates: an element with no offset anywhere is a shape failure, not the end", async () => {
  const { send } = recorder([{ status: 200, body: [{ update: { Transaction: { value: {} } } }] }]);
  const result = await callGetUpdates(send, PARTIES, 10, 100);
  assert.ok(!result.ok);
  assert.equal(result.reason, "node_error");
});
