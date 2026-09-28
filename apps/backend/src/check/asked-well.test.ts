// **The question-side check, tested on its own.**
//
// It cannot be shown alive by breaking the product and running the recorded check: a request that changed is
// a tape key that changed, so replay fails first with "that question is not on the tape" and this check
// never gets to speak. That protection is the frozen tape's accident, not a judgement — it disappears the
// moment the tape is re-recorded, and it never existed for a live run against a participant. Which is
// exactly why the rule exists, and why it is exercised here directly.
import assert from "node:assert/strict";
import test from "node:test";
import { questionProblems } from "./asked-well.ts";
import type { Given } from "./given.ts";
import type { NodeCall } from "./trace.ts";

const WILDCARD = [
  { identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } },
];

const holder: Given = {
  parties: [
    { party: "alice::1220", kinds: ["CanReadAs"] },
    { party: "acme::1220", kinds: ["CanReadAs"] },
  ],
  readsEveryParty: false,
  seesContracts: true,
  seesMoreThanOnePage: true,
  seesUpdates: true,
};

const superReader: Given = {
  parties: [],
  readsEveryParty: true,
  seesContracts: true,
  seesMoreThanOnePage: true,
  seesUpdates: true,
};

const end = (offset: number): NodeCall => ({
  method: "GET",
  path: "/v2/state/ledger-end",
  body: null,
  status: 200,
  answer: { offset },
});

const acs = (parties: readonly string[], at: number, anyParty = false): NodeCall => ({
  method: "POST",
  path: "/v2/state/active-contracts?limit=200",
  body: {
    filter: {
      filtersByParty: Object.fromEntries(parties.map((p) => [p, { cumulative: WILDCARD }])),
      ...(anyParty ? { filtersForAnyParty: { cumulative: WILDCARD } } : {}),
    },
    verbose: true,
    activeAtOffset: at,
  },
  status: 200,
  answer: [],
});

const pointLookup = (updateId: string): NodeCall => ({
  method: "POST",
  path: "/v2/updates/update-by-id",
  body: { updateId, updateFormat: {} },
  status: 200,
  answer: {},
});

test("a question that names every party of mine at the right offset is right", () => {
  const trace = [end(161), acs(["alice::1220", "acme::1220"], 161)];
  assert.deepEqual(questionProblems("/api/contracts", trace, holder), []);
});

test("asking about fewer parties than I hold is the defect this exists for", () => {
  // **The one the product must never have.** A narrowed request makes a smaller answer, which the tape
  // then holds, which replay then serves, which every other level then agrees with perfectly.
  const trace = [end(161), acs(["alice::1220"], 161)];
  const problems = questionProblems("/api/contracts", trace, holder);
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /asked about 1 of this person's 2 parties/);
});

test("the order the parties are named in is not a claim", () => {
  // The node takes them as an object's keys, so a different order is the same question.
  const trace = [end(161), acs(["acme::1220", "alice::1220"], 161)];
  assert.deepEqual(questionProblems("/api/contracts", trace, holder), []);
});

test("a super reader names nobody, and that is the wider question, not a narrower one", () => {
  const trace = [end(161), acs([], 161, true)];
  assert.deepEqual(questionProblems("/api/contracts", trace, superReader), []);
});

test("asking as any party without having been given that right is a finding", () => {
  const trace = [end(161), acs([], 161, true)];
  const problems = questionProblems("/api/contracts", trace, holder);
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /was not given that right/);
});

test("reading at some other offset is reading some other moment", () => {
  const trace = [end(161), acs(["alice::1220", "acme::1220"], 120)];
  const problems = questionProblems("/api/contracts", trace, holder);
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /read the contracts at 120, not at the ledger end 161/);
});

test("an offset the caller named is the caller's to choose", () => {
  const trace = [end(161), acs(["alice::1220", "acme::1220"], 120)];
  assert.deepEqual(questionProblems("/api/contracts?offset=120", trace, holder), []);
});

test("a point lookup that asks for another update than the address named is a finding", () => {
  // Without this the mapping reads whatever came back and builds the expected answer out of it — so a
  // router that looked up the wrong update would be agreed with, slot for slot.
  const trace = [end(161), pointLookup("1220bb")];
  const problems = questionProblems("/api/updates/1220aa", trace, holder);
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /named one update and the node was asked for another/);
});

test("a point lookup that asks for the update the address named is right", () => {
  const trace = [end(161), pointLookup("1220aa")];
  assert.deepEqual(questionProblems("/api/updates/1220aa", trace, holder), []);
});

test("the party filter is found under the update format too, not only on a contracts request", () => {
  // The two requests bury it at different depths; a check that only knew the shallower one would pass every
  // narrowed updates question in silence.
  const narrowed: NodeCall = {
    method: "POST",
    path: "/v2/updates?limit=200",
    body: {
      updateFormat: {
        includeTransactions: {
          eventFormat: {
            filtersByParty: { "alice::1220": { cumulative: WILDCARD } },
          },
          transactionShape: "TRANSACTION_SHAPE_ACS_DELTA",
        },
      },
      beginExclusive: 0,
      endInclusive: 161,
    },
    status: 200,
    answer: [],
  };
  const problems = questionProblems("/api/updates", [end(161), narrowed], holder);
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /asked about 1 of this person's 2 parties/);
});

const updatesStep = (beginExclusive: number, endInclusive: number): NodeCall => ({
  method: "POST",
  path: "/v2/updates?limit=200",
  body: {
    updateFormat: {
      includeTransactions: {
        eventFormat: {
          filtersByParty: {
            "alice::1220": { cumulative: WILDCARD },
            "acme::1220": { cumulative: WILDCARD },
          },
        },
        transactionShape: "TRANSACTION_SHAPE_ACS_DELTA",
      },
    },
    beginExclusive,
    endInclusive,
  },
  status: 200,
  answer: [],
});

test("the recent window may be asked for in abutting steps, each older one ending where the last began", () => {
  // A quiet viewer on a busy participant: the first 500 offsets hold nothing of theirs, so the window
  // widens. Every step but the first ends short of the ledger end — at the start of the step before it —
  // and that is one window, not several moments.
  const trace = [
    end(100_000),
    updatesStep(99_500, 100_000),
    updatesStep(98_000, 99_500),
    updatesStep(92_000, 98_000),
  ];
  assert.deepEqual(questionProblems("/api/updates", trace, holder), []);
});

test("an updates step that ends neither at the ledger end nor where another step began is some other moment", () => {
  const trace = [end(100_000), updatesStep(99_500, 100_000), updatesStep(98_000, 99_400)];
  const problems = questionProblems("/api/updates", trace, holder);
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /read the updates up to 99400, not to the ledger end 100000/);
});
