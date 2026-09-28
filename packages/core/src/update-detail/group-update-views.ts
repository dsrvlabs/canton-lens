// **Who each part of the transaction went to.** Canton does not send a transaction to its parties whole: it
// cuts it into *views* and encrypts each view to the participants that must receive it. The cut is the privacy
// boundary, and it is the thing this explorer exists to show.
//
// **What this can and cannot compute.** Canton cuts on *participants*, not parties: a node joins its parent's
// view when the participants hosting its informees are a subset of that view's, and starts a new view only
// when a new participant comes in (`TransactionViewDecompositionFactory.needNewView`; a node whose informees
// narrow joins its parent). This response carries neither participants nor a node's own informees — only
// `witnessParties`, the *cumulative* informees (this node's and every ancestor's), limited to the parties the
// reader asked as. So the grouping here is
//
//     the events you received, cut where the set of your parties that received them changes
//
// and not Canton's views. The two differ in both directions. A new party here may be hosted on a participant
// already receiving the view — one view to Canton, a new group here; on a stack where every party sits on one
// participant, that is every boundary drawn. And a party you did not ask as never appears — a new view to
// Canton, no group here. So these groups are neither a subset nor a superset of Canton's views, and the screen
// must not call them views. Hence the name — a group, not a view.
//
// The set on a group is exact for the one question it answers: cumulative sets only grow downwards, so every
// event in a group went to the same parties of yours, and that is what the band says.
//
// One more reason it is not the node's decomposition: nodes you are not a witness of never arrive at all, so
// this is cut out of a projection, not out of the transaction.

export type UpdateViewGroup = {
  // The witness set every event in the group shares, in the order the first of them carried it.
  witnesses: string[];
  // The events in it, by their index in the update's event list, in the order they arrived.
  eventIndexes: number[];
  // The group this one sits inside — the group of its first event's ancestor. null at the top.
  parentIndex: number | null;
  // How many groups enclose this one. 0 is a top-level group.
  depth: number;
};

export type GroupableEvent = {
  witnessParties: string[];
  tree: { ancestorIndex: number | null };
};

// A set, written the same way whatever order it arrived in — two events are in one group when the parties
// match, not when the arrays match.
const asSet = (parties: readonly string[]): string => [...new Set(parties)].sort().join("\u0000");

export function groupUpdateViews(events: readonly GroupableEvent[]): UpdateViewGroup[] {
  const groups: UpdateViewGroup[] = [];
  // Which group each event landed in, so a child can ask where its ancestor went.
  const groupOf = new Map<number, number>();

  events.forEach((event, index) => {
    const witnesses = event.witnessParties;
    const ancestorIndex = event.tree.ancestorIndex;
    const ancestorGroup = ancestorIndex === null ? undefined : groupOf.get(ancestorIndex);
    const enclosing = ancestorGroup === undefined ? undefined : groups[ancestorGroup];

    // An event joins the group above it when it went to exactly the same parties. Anything else — a root, or
    // a witness set that changed — starts a group, and that is where a view boundary would fall.
    if (
      enclosing !== undefined &&
      ancestorGroup !== undefined &&
      asSet(enclosing.witnesses) === asSet(witnesses)
    ) {
      enclosing.eventIndexes.push(index);
      groupOf.set(index, ancestorGroup);
      return;
    }
    groups.push({
      witnesses: [...witnesses],
      eventIndexes: [index],
      parentIndex: ancestorGroup ?? null,
      depth: enclosing === undefined ? 0 : enclosing.depth + 1,
    });
    groupOf.set(index, groups.length - 1);
  });

  return groups;
}
