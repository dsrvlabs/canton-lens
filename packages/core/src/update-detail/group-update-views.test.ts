import assert from "node:assert/strict";
import { test } from "node:test";
import { groupUpdateViews } from "./group-update-views.ts";

const SUF = "1220e2b3c32f91feb4a21be4ea30a8302f1e9825e8ee2c9b3dd1bac4b84730372db9";
const ALICE = `alice::${SUF}`;
const BOB = `bob::${SUF}`;
const CAROL = `carol::${SUF}`;

const event = (witnessParties: string[], ancestorIndex: number | null) => ({
  witnessParties,
  tree: { ancestorIndex },
});

test("one event is one group", () => {
  assert.deepEqual(groupUpdateViews([event([BOB], null)]), [
    { witnesses: [BOB], eventIndexes: [0], parentIndex: null, depth: 0 },
  ]);
});

test("a child that went to the same parties joins the group above it", () => {
  const groups = groupUpdateViews([event([BOB, ALICE], null), event([BOB, ALICE], 0)]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]?.eventIndexes, [0, 1]);
});

test("the same parties in another order are the same set — it is a set, not a list", () => {
  const groups = groupUpdateViews([event([BOB, ALICE], null), event([ALICE, BOB], 0)]);
  assert.equal(groups.length, 1);
});

test("a child that went further starts a group, and it sits inside the one above", () => {
  // The Accept reached carol too; the Holding it created did not.
  const groups = groupUpdateViews([event([BOB, ALICE, CAROL], null), event([BOB, ALICE], 0)]);
  assert.deepEqual(groups, [
    { witnesses: [BOB, ALICE, CAROL], eventIndexes: [0], parentIndex: null, depth: 0 },
    { witnesses: [BOB, ALICE], eventIndexes: [1], parentIndex: 0, depth: 1 },
  ]);
});

test("a boundary and then a return to the first set is a third group, not the first one again", () => {
  // Groups follow the tree. Two regions that happen to share a witness set are still two regions, because a
  // view is a place in the transaction, not a set of parties.
  const groups = groupUpdateViews([event([BOB], null), event([BOB, ALICE], 0), event([BOB], 1)]);
  assert.equal(groups.length, 3);
  assert.deepEqual(
    groups.map((g) => g.eventIndexes),
    [[0], [1], [2]],
  );
  assert.deepEqual(
    groups.map((g) => g.depth),
    [0, 1, 2],
  );
});

test("two roots are two groups even when they went to the same parties", () => {
  const groups = groupUpdateViews([event([BOB], null), event([BOB], null)]);
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((g) => g.parentIndex),
    [null, null],
  );
});

test("an event whose ancestor is not in the list starts a group of its own", () => {
  // nestUpdateEvents leaves ancestorIndex null when nothing shown encloses an event; a group cannot be
  // joined to something that never arrived.
  const groups = groupUpdateViews([event([BOB], null), event([BOB], null)]);
  assert.deepEqual(groups[1]?.parentIndex, null);
});

test("no events, no groups", () => {
  assert.deepEqual(groupUpdateViews([]), []);
});
