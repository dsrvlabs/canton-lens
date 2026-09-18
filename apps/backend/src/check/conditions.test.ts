// **The list of data conditions, pinned.**
//
// The pass itself only says "nothing showed this". That is enough to catch a seed that shrank, and useless
// against the other way out: deleting the condition. A rule whose material went away and whose condition went
// away with it is green again, and nothing anywhere says a sentence stopped being exercised.
//
// So the names are written out here. Removing one is a change to this file, which is a line in a diff and a
// question in a review — the same discipline the `unjudged` listing test keeps (mapping.test.ts).
import assert from "node:assert/strict";
import test from "node:test";
import { CONDITIONS, OUT_OF_REACH, type Sighting, unmet } from "./conditions.ts";
import type { Given } from "./given.ts";

/** Somebody the seed filled up — so an empty answer for them is an empty answer, not a correct one. */
const PROVISIONED: Given = {
  parties: [{ party: "alice::1220", kinds: ["CanReadAs"] }],
  readsEveryParty: false,
  seesContracts: true,
  seesMoreThanOnePage: true,
  seesUpdates: true,
};

const NOBODY: Given = {
  parties: [{ party: "dave::1220", kinds: ["CanReadAs"] }],
  readsEveryParty: false,
  seesContracts: false,
  seesMoreThanOnePage: false,
  seesUpdates: false,
};

const nothing = (label: string): Sighting => ({
  user: "someone",
  given: PROVISIONED,
  label,
  url: label,
  body: {},
  trace: [],
});

test("every data condition the recording owes, by name", () => {
  assert.deepEqual(
    CONDITIONS.map((c) => c.name),
    [
      "somebody sees more active contracts than one node page holds, so the walk resumes",
      "the second page of a list is actually asked for, with the cursor the first page gave",
      "one list is long enough that the first page is not the whole of it",
      "somebody holds a token whose balance decays by the round",
      "a contract whose standard view the node could not compute",
      "one person holds an expired and an unexpired preapproval with the same receiver",
      "a contract created and archived inside one window",
      "an opened update where one of my parties is an observer and not a signatory",
      "an opened update where one of my parties saw an event it is not a party to",
      "an opened update where a party is both a stakeholder and listed among the witnesses",
      "somebody's home page has more recent updates than it draws",
      "a person the seed left nothing at all",
    ],
  );
});

test("and the ones no seed on this stack can give, with the reason", () => {
  assert.deepEqual(
    OUT_OF_REACH.map((c) => c.name),
    [
      "a point lookup that answers something other than a transaction",
      "a contract detail drawn from an interface view",
      "a preapproval or a holding whose payload is not the shape its template declares",
      "a session answer whose token can be decoded",
      "a lifeline in the `unknown` state",
    ],
  );
  // A reason that says nothing is the failure mode here — "not reachable" with no account of why reads as an
  // oversight, which is exactly what this list exists to distinguish itself from.
  for (const one of OUT_OF_REACH) assert.ok(one.why.length > 40, `${one.name} has no reason`);
});

test("each condition says which rule it keeps alive", () => {
  for (const condition of CONDITIONS) {
    assert.ok(condition.keeps.length > 40, `${condition.name} does not say what it keeps`);
  }
});

test("a recording that holds nothing fails every one of them", () => {
  // **The pass has to be able to fail.** A condition whose predicate is accidentally true of an empty answer
  // — reading a slot at the wrong depth is the usual way — reports a green that means nothing, and it reads
  // exactly like a recording that is complete.
  const empty = [
    "/api/contracts",
    "/api/contracts?pageSize=2",
    "/api/contracts (the second page)",
    "/api/holdings",
    "/api/offers",
    "/api/preapprovals",
    "/api/timeline",
    "/api/home",
    "/api/updates/{updateId}",
  ].map(nothing);
  assert.equal(unmet(empty).length, CONDITIONS.length);
});

test("the one condition that is about a person rather than an answer is met by that person", () => {
  // It is the odd one out on purpose: "somebody the seed left nothing" is a fact about who was recorded, not
  // about what any one answer said, and it is the precondition for every rule that requires a list to be
  // *empty*. Kept on the same list so that losing that person is the same kind of finding as losing a row.
  const lonely: Sighting = {
    user: "dave",
    given: NOBODY,
    label: "/api/contracts",
    url: "/api/contracts",
    body: {},
    trace: [],
  };
  const names = unmet([lonely]).map((c) => c.name);
  assert.ok(!names.includes("a person the seed left nothing at all"));
});

test("and one that holds nothing at all is not quietly complete", () => {
  assert.equal(unmet([]).length, CONDITIONS.length);
});
