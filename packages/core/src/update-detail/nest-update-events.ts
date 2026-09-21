// A transaction is a **tree**, and the ledger says so: every event carries a node id, and an exercised event
// carries the last node id of everything that happened under it (lastDescendantNodeId). A node belongs to an
// exercise when its node id falls in (nodeId, lastDescendantNodeId] — the pre-order numbering Daml gives the
// nodes is what makes that interval test sound.
//
// What this does **not** claim is that the parent it finds is the direct parent. LEDGER_EFFECTS answers with
// the events the reader is entitled to see, so nodes in between may be missing. An event is therefore placed
// under the **nearest enclosing event that is present**, and depth counts the nesting of what is shown, not the
// nesting on the ledger. The screen says so next to the table; here the name says it too (ancestorIndex, not
// parentIndex).
//
// Events are addressed by their position in the list (index), not by node id, because the rest of the response
// already names an event that way ("visible to you because … on event 2").

export type UpdateEventPlacement = {
  // How many shown events enclose this one. 0 is a root of the shown tree.
  depth: number;
  // The index of the nearest enclosing event that is shown, or null when nothing shown encloses it.
  ancestorIndex: number | null;
  // How many shown events fall under this one, at any depth. 0 for a leaf, and for every created event.
  descendantCount: number;
};

export type NestableEvent = {
  nodeId: number | null;
  lastDescendantNodeId: number | null;
};

type OrderedEvent = { nodeId: number; lastDescendantNodeId: number | null };

const flat = (count: number): UpdateEventPlacement[] =>
  Array.from({ length: count }, () => ({ depth: 0, ancestorIndex: null, descendantCount: 0 }));

// Node ids arrive ascending — that is the pre-order walk of the tree, and the interval test relies on it. If they
// do not (a node id missing, or an order nobody promised), nothing is nested rather than something nested wrongly:
// every event comes back a root, which is the flat list this screen drew before.
function inNodeOrder(events: readonly NestableEvent[]): OrderedEvent[] | null {
  const ordered: OrderedEvent[] = [];
  for (const event of events) {
    const previous = ordered.at(-1);
    if (typeof event.nodeId !== "number") return null;
    if (previous !== undefined && event.nodeId <= previous.nodeId) return null;
    ordered.push({ nodeId: event.nodeId, lastDescendantNodeId: event.lastDescendantNodeId });
  }
  return ordered;
}

export function nestUpdateEvents(events: readonly NestableEvent[]): UpdateEventPlacement[] {
  const ordered = inNodeOrder(events);
  if (ordered === null) return flat(events.length);

  const placements = flat(events.length);
  // The exercises still open, outermost first. One closes as soon as an event arrives past its last descendant.
  const open: { index: number; lastDescendantNodeId: number }[] = [];
  for (const [index, event] of ordered.entries()) {
    for (
      let innermost = open.at(-1);
      innermost !== undefined && innermost.lastDescendantNodeId < event.nodeId;
      innermost = open.at(-1)
    )
      open.pop();
    const enclosing = open.at(-1);
    placements[index] = {
      depth: open.length,
      ancestorIndex: enclosing?.index ?? null,
      descendantCount: 0,
    };
    for (const ancestor of open) {
      const counted = placements[ancestor.index];
      if (counted !== undefined) counted.descendantCount += 1;
    }
    // An exercise with nothing under it has lastDescendantNodeId === nodeId, and opens nothing.
    if (event.lastDescendantNodeId !== null && event.lastDescendantNodeId > event.nodeId)
      open.push({ index, lastDescendantNodeId: event.lastDescendantNodeId });
  }
  return placements;
}
