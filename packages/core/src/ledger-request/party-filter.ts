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
// would narrow the very thing it is for. Sent this way against Canton 3.5.15 it is answered 200 for a
// CanReadAsAnyParty token, and returns strictly more than the same viewer's own parties do.

import { isRecord } from "../internal/guards.ts";
import type { LedgerPartyFilter } from "./types.ts";

export function eventFormatFilters(
  filter: LedgerPartyFilter,
  cumulativeEntry: unknown,
): { filtersByParty: Record<string, { cumulative: unknown[] }>; filtersForAnyParty?: unknown } {
  // **Judged before it is used.** This union replaced a plain string[], and not every caller is
  // typechecked — the live scripts in apps/backend/src/live are plain JavaScript. Reading `"anyParty" in
  // filter` first would make `null` die on the engine's own message, and would read `{ anyParty: false }`
  // as a request to read everything, which is the opposite of what it says.
  const anyParty = isRecord(filter) && (filter as { anyParty?: unknown }).anyParty === true;
  const parties = isRecord(filter) ? (filter as { parties?: unknown }).parties : undefined;
  if (!anyParty && !Array.isArray(parties)) {
    throw new TypeError(
      "a ledger party filter is { parties: string[] } or { anyParty: true } — a bare party list is not one",
    );
  }
  if (anyParty) {
    return { filtersByParty: {}, filtersForAnyParty: { cumulative: [cumulativeEntry] } };
  }
  const filtersByParty: Record<string, { cumulative: unknown[] }> = {};
  for (const party of parties as readonly string[]) {
    filtersByParty[party] = { cumulative: [cumulativeEntry] };
  }
  return { filtersByParty };
}

// **There is deliberately no ownPartiesOf(filter) here.** It reads as the obvious companion and it would be
// wrong: the filter says what the ledger is asked with, and a viewer holding CanReadAsAnyParty may hold
// parties of their own as well. Deriving "whose mine is it" from the filter is exactly the conflation this
// union was split out of. The two are carried separately by whoever knows both.
