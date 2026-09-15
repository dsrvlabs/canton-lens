// Turns a LedgerPartyFilter into the two keys Canton's EventFormat takes, so that the ACS request, the
// updates request and the two point lookups all spell the same thing the same way. They used to build
// `filtersByParty` inline, each with its own loop, which was fine while there was one shape to build.
//
// **The wildcard/interface entry is the caller's**, because it differs between them — the ACS asks for an
// interface view on some routes and a plain wildcard on others, the updates request always asks for the
// wildcard. Only the party scoping is decided here.
//
// **`filtersForAnyParty` is sent alone, with `filtersByParty` left empty.** The node's document calls it
// "wildcard filters that apply to all the parties existing on the participant"; naming parties beside it
// would narrow the very thing it is for. Measured on Canton 3.5.15 (2026-09-15): sent this way with a
// CanReadAsAnyParty token it answers 200 and returns strictly more than the same viewer's own parties do
// (40 elements against 9 on the test stack).

import type { LedgerPartyFilter } from "./types.ts";

export function eventFormatFilters(
  filter: LedgerPartyFilter,
  cumulativeEntry: unknown,
): { filtersByParty: Record<string, { cumulative: unknown[] }>; filtersForAnyParty?: unknown } {
  if ("anyParty" in filter) {
    return { filtersByParty: {}, filtersForAnyParty: { cumulative: [cumulativeEntry] } };
  }
  const filtersByParty: Record<string, { cumulative: unknown[] }> = {};
  for (const party of filter.parties) {
    filtersByParty[party] = { cumulative: [cumulativeEntry] };
  }
  return { filtersByParty };
}

// The parties a "which of these are mine" question may be answered with. An instance-wide viewer reads as
// no party at all, and that is not the same as holding none: the difference is what the caller must carry
// into the answer, so it is spelled here rather than left to `"parties" in filter ? … : []` at each site.
export const ownPartiesOf = (filter: LedgerPartyFilter): readonly string[] =>
  "anyParty" in filter ? [] : filter.parties;
