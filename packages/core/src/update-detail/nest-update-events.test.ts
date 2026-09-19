import assert from "node:assert/strict";
import { test } from "node:test";
import { nestUpdateEvents } from "./nest-update-events.ts";

// The shape of the material is what a point lookup (LEDGER_EFFECTS) hands over: node ids ascending, and
// lastDescendantNodeId on the exercised ones. A created event carries no descendants, so null.
const created = (nodeId: number) => ({ nodeId, lastDescendantNodeId: null });
const exercised = (nodeId: number, lastDescendantNodeId: number) => ({
  nodeId,
  lastDescendantNodeId,
});

test("a single event is a root — one event is a tree of one", () => {
  assert.deepEqual(nestUpdateEvents([created(0)]), [
    { depth: 0, ancestorIndex: null, descendantCount: 0 },
  ]);
});

test("what the exercise created stands under it — the recorded Accept, whose Holding is node 1", () => {
  // Offset 150 of the recorded tape: Accept on TransferOffer (node 0, last descendant 1) creates a Holding.
  assert.deepEqual(nestUpdateEvents([exercised(0, 1), created(1)]), [
    { depth: 0, ancestorIndex: null, descendantCount: 1 },
    { depth: 1, ancestorIndex: 0, descendantCount: 0 },
  ]);
});

test("an exercise that did nothing under it opens nothing — last descendant is its own node id", () => {
  // Offset 156 of the tape: Withdraw archives the offer and creates nothing.
  assert.deepEqual(nestUpdateEvents([exercised(0, 0), created(1)]), [
    { depth: 0, ancestorIndex: null, descendantCount: 0 },
    { depth: 0, ancestorIndex: null, descendantCount: 0 },
  ]);
});

test("nesting goes as deep as the ledger does, and every ancestor counts the whole subtree", () => {
  const placements = nestUpdateEvents([
    exercised(0, 3), // root
    exercised(1, 3), //   under 0
    created(2), //       under 1
    created(3), //       under 1
    created(4), // a sibling of the root, past its last descendant
  ]);
  assert.deepEqual(placements, [
    { depth: 0, ancestorIndex: null, descendantCount: 3 },
    { depth: 1, ancestorIndex: 0, descendantCount: 2 },
    { depth: 2, ancestorIndex: 1, descendantCount: 0 },
    { depth: 2, ancestorIndex: 1, descendantCount: 0 },
    { depth: 0, ancestorIndex: null, descendantCount: 0 },
  ]);
});

test("a node not shown is not invented — the child stands under the nearest ancestor that is present", () => {
  // The reader is not an informee on node 1, so it does not arrive. Node 2 is still inside node 0's range.
  assert.deepEqual(nestUpdateEvents([exercised(0, 2), created(2)]), [
    { depth: 0, ancestorIndex: null, descendantCount: 1 },
    { depth: 1, ancestorIndex: 0, descendantCount: 0 },
  ]);
});

test("a missing node id nests nothing — the list stays as flat as it arrived", () => {
  assert.deepEqual(nestUpdateEvents([{ nodeId: null, lastDescendantNodeId: 1 }, created(1)]), [
    { depth: 0, ancestorIndex: null, descendantCount: 0 },
    { depth: 0, ancestorIndex: null, descendantCount: 0 },
  ]);
});

test("node ids out of order nest nothing — a guess is worse than the flat list", () => {
  assert.deepEqual(nestUpdateEvents([exercised(5, 9), created(1)]), [
    { depth: 0, ancestorIndex: null, descendantCount: 0 },
    { depth: 0, ancestorIndex: null, descendantCount: 0 },
  ]);
});

test("no events, no placements", () => {
  assert.deepEqual(nestUpdateEvents([]), []);
});
