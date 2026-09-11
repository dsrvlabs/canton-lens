import { interpretLedgerResponse } from "./interpret.ts";
import type { LedgerCallResult, LedgerRequest, LedgerSend } from "./types.ts";

// Asks for the updates (transactions) in the recent window. For the same reason as the ACS, the party scope
// is given only via filter.filtersByParty — Canton is the one doing the filtering.
//
// The point of this request is that beginExclusive is not set to 0. The participant holds only the history
// up to pruning, and this product does not serve older history.
// What this request answers goes only as far as “what was visible to me in the recent window”.
export function buildGetUpdatesRequest(
  parties: readonly string[],
  beginExclusive: number,
  endInclusive: number,
): LedgerRequest {
  const wildcard = {
    identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } },
  };
  const filtersByParty: Record<string, { cumulative: unknown[] }> = {};
  for (const party of parties) {
    filtersByParty[party] = { cumulative: [wildcard] };
  }
  return {
    method: "POST",
    path: "/v2/updates",
    body: {
      beginExclusive,
      endInclusive,
      verbose: false,
      updateFormat: {
        includeTransactions: {
          eventFormat: { filtersByParty, verbose: false },
          // ACS_DELTA: events arrive as “how the active set changed” (created/archived).
          // That is exactly what the screen wants to say — a contract appeared/disappeared.
          transactionShape: "TRANSACTION_SHAPE_ACS_DELTA",
        },
      },
    },
  };
}

export async function callGetUpdates(
  send: LedgerSend,
  parties: readonly string[],
  beginExclusive: number,
  endInclusive: number,
): Promise<LedgerCallResult<unknown>> {
  const request = buildGetUpdatesRequest(parties, beginExclusive, endInclusive);
  try {
    const { status, body } = await send(request);
    return interpretLedgerResponse<unknown>(status, body);
  } catch (error) {
    return {
      ok: false,
      reason: "unreachable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
