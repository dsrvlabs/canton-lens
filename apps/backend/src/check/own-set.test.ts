// The answer key's own rules, checked here because the recording that will use them does not exist yet. What
// is being pinned down is the shape of the mistake each guard exists to stop.
import assert from "node:assert/strict";
import test from "node:test";
import {
  compareIdSets,
  contractsAskedEverything,
  type OwnSet,
  updatesAskedEverything,
  validateOwnSet,
} from "./own-set.ts";

const WILDCARD = { cumulative: [{ identifierFilter: { WildcardFilter: { value: {} } } }] };
const INTERFACE = {
  cumulative: [{ identifierFilter: { InterfaceFilter: { value: { interfaceId: "x" } } } }],
};

const contractsBody = (filters: unknown) => ({ filter: { filtersByParty: filters } });
const updatesBody = (filters: unknown) => ({
  updateFormat: { includeTransactions: { eventFormat: { filtersByParty: filters } } },
});

test("a question that named a template or an interface is not a question for everything", () => {
  assert.equal(contractsAskedEverything(contractsBody({ alice: WILDCARD })), true);
  assert.equal(contractsAskedEverything(contractsBody({ alice: INTERFACE })), false);
  // **One narrowed party out of two is still narrowed.** That person's contracts would be missing from the
  // answer key, and an application that drops them would pass.
  assert.equal(contractsAskedEverything(contractsBody({ alice: WILDCARD, bob: INTERFACE })), false);
  // A request naming nobody asks for nothing — it is not "everything".
  assert.equal(contractsAskedEverything(contractsBody({})), false);
  // The super reader's shape names no party and is still a question for everything.
  assert.equal(
    contractsAskedEverything({ filter: { filtersForAnyParty: WILDCARD.cumulative } }),
    true,
  );
  assert.equal(updatesAskedEverything(updatesBody({ alice: WILDCARD })), true);
  assert.equal(updatesAskedEverything(updatesBody({ alice: INTERFACE })), false);
  // The updates filter sits one level deeper; a body shaped like the contracts one is not that question.
  assert.equal(updatesAskedEverything(contractsBody({ alice: WILDCARD })), false);
});

test("the two directions of a difference are different defects and stay apart", () => {
  const difference = compareIdSets(["a", "b", "c"], ["b", "c", "d"]);
  // "The node says they can see it and we did not show it" — something of theirs went missing.
  assert.deepEqual(difference.missing, ["a"]);
  // "We showed something the node never said they can see" — the other direction, and the worse one.
  assert.deepEqual(difference.extra, ["d"]);
  assert.deepEqual(compareIdSets(["a"], ["a"]), { missing: [], extra: [] });
});

const entry = (over: Partial<OwnSet["entries"][number]> = {}) => ({
  who: "alice",
  parties: ["alice::1220"],
  askedAsAnyParty: false,
  asked: {
    contracts: contractsBody({ "alice::1220": WILDCARD }),
    updates: updatesBody({ "alice::1220": WILDCARD }),
  },
  contractIds: ["c1"],
  updateIds: ["u1"],
  stoppedBecause: "node_had_no_more" as const,
  ...over,
});

test("an answer key that cannot be one is refused before anything is compared against it", () => {
  assert.deepEqual(validateOwnSet({ atOffset: 158, entries: [entry()] }, 158), []);
  // Taken at another point, it disagrees about everything created in between, and every difference reads as
  // a defect.
  assert.equal(validateOwnSet({ atOffset: 157, entries: [entry()] }, 158).length, 1);
  assert.equal(validateOwnSet({ atOffset: 158, entries: [] }, 158).length, 1);
  // Short because the recorder gave up, not because the node ran out.
  assert.equal(
    validateOwnSet({ atOffset: 158, entries: [entry({ stoppedBecause: "page_limit" })] }, 158)
      .length,
    1,
  );
  // Narrowed — the answer key would be smaller than the truth.
  assert.equal(
    validateOwnSet(
      {
        atOffset: 158,
        entries: [
          entry({
            asked: {
              contracts: contractsBody({ "alice::1220": INTERFACE }),
              updates: updatesBody({ "alice::1220": WILDCARD }),
            },
          }),
        ],
      },
      158,
    ).length,
    1,
  );
  // Naming no party without asking as every party is a question for nothing.
  assert.ok(validateOwnSet({ atOffset: 158, entries: [entry({ parties: [] })] }, 158).length >= 1);
  // Asking as every party *and* naming some narrows it back down.
  assert.equal(
    validateOwnSet(
      {
        atOffset: 158,
        entries: [
          entry({
            askedAsAnyParty: true,
            asked: {
              contracts: { filter: { filtersForAnyParty: WILDCARD.cumulative } },
              updates: {
                updateFormat: {
                  includeTransactions: { eventFormat: { filtersForAnyParty: WILDCARD.cumulative } },
                },
              },
            },
          }),
        ],
      },
      158,
    ).length,
    1,
  );
});
