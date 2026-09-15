import {
  collectLedgerPages,
  LEDGER_PAGE_SIZE,
  type LedgerPageCursor,
  withPageLimit,
} from "./paginate.ts";
import { eventFormatFilters } from "./party-filter.ts";
import type { LedgerCallResult, LedgerPartyFilter, LedgerRequest, LedgerSend } from "./types.ts";

// Asks for the updates (transactions) in the recent window. For the same reason as the ACS, the party scope
// is given only via the event format's filtersByParty / filtersForAnyParty — Canton is the one doing the
// filtering.
//
// The point of this request is that beginExclusive is not set to 0. The participant holds only the history
// up to pruning, and this product does not serve older history.
// What this request answers goes only as far as “what was visible to me in the recent window”.
//
// **The window is asked for in parts too.** An offset window is not a bound on how many updates it holds, so
// a busy ledger can put more than the node's list limit inside one. This endpoint has no continuation token —
// the node's OpenAPI gives it `limit` and nothing else — but it does not need one: every element carries the
// offset it sits at, and beginExclusive is itself the position to resume from. So the cursor here is a number
// rather than an opaque string, and the rule about when the walk ends is the same one, in paginate.ts.
export function buildGetUpdatesRequest(
  filter: LedgerPartyFilter,
  beginExclusive: number,
  endInclusive: number,
): LedgerRequest {
  const wildcard = {
    identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } },
  };
  return {
    method: "POST",
    path: withPageLimit("/v2/updates", LEDGER_PAGE_SIZE),
    body: {
      beginExclusive,
      endInclusive,
      verbose: false,
      updateFormat: {
        includeTransactions: {
          eventFormat: { ...eventFormatFilters(filter, wildcard), verbose: false },
          // ACS_DELTA: events arrive as “how the active set changed” (created/archived).
          // That is exactly what the screen wants to say — a contract appeared/disappeared.
          transactionShape: "TRANSACTION_SHAPE_ACS_DELTA",
        },
      },
    },
  };
}

// Every shape an update arrives in — Transaction · Reassignment · TopologyTransaction · OffsetCheckpoint —
// is `{ <name>: { value: { offset, … } } }`, and the node's schema marks offset required on all four. The
// stream is ascending (descendingOrder is not set), so the last element's offset is where the next part
// begins exclusively.
function readLastOffset(lastElement: unknown): LedgerPageCursor | undefined {
  if (typeof lastElement !== "object" || lastElement === null) return undefined;
  const update = (lastElement as { update?: unknown }).update;
  if (typeof update !== "object" || update === null) return undefined;
  for (const variant of Object.values(update as Record<string, unknown>)) {
    if (typeof variant !== "object" || variant === null) continue;
    const value = (variant as { value?: unknown }).value;
    if (typeof value !== "object" || value === null) continue;
    const offset = (value as { offset?: unknown }).offset;
    if (typeof offset === "number") return offset;
  }
  return undefined;
}

export async function callGetUpdates(
  send: LedgerSend,
  filter: LedgerPartyFilter,
  beginExclusive: number,
  endInclusive: number,
): Promise<LedgerCallResult<unknown>> {
  return await collectLedgerPages(
    send,
    (cursor) =>
      buildGetUpdatesRequest(
        filter,
        cursor === undefined ? beginExclusive : Number(cursor),
        endInclusive,
      ),
    readLastOffset,
  );
}
