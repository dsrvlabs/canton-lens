import { interpretLedgerResponse } from "./interpret.ts";
import type { LedgerCallResult, LedgerRequest, LedgerSend } from "./types.ts";

// **Point lookup** of a single update (Transactions screen query layout, Canton 3.4 OpenAPI
// `POST /v2/updates/update-by-id`). For the list, the ACS_DELTA stream lightly answers “what was created and what disappeared”,
// and for the detail, this request answers “who exercised which choice with which arguments” via LEDGER_EFFECTS — the two shapes are mutually exclusive,
// so they cannot be produced by one request. The user does not choose; the server decides per screen.
//
// In LEDGER_EFFECTS, witnessParties are **informees**, not stakeholders (OpenAPI: create·exercise events whose
// witnesses include the party). Its meaning differs from signatories and observers.
export function updateFormatLedgerEffects(parties: readonly string[]): unknown {
  const wildcard = {
    identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } },
  };
  const filtersByParty: Record<string, { cumulative: unknown[] }> = {};
  for (const party of parties) {
    filtersByParty[party] = { cumulative: [wildcard] };
  }
  return {
    includeTransactions: {
      eventFormat: { filtersByParty, verbose: false },
      transactionShape: "TRANSACTION_SHAPE_LEDGER_EFFECTS",
    },
  };
}

export function buildGetUpdateByIdRequest(
  parties: readonly string[],
  updateId: string,
): LedgerRequest {
  return {
    method: "POST",
    path: "/v2/updates/update-by-id",
    body: { updateId, updateFormat: updateFormatLedgerEffects(parties) },
  };
}

export async function callGetUpdateById(
  send: LedgerSend,
  parties: readonly string[],
  updateId: string,
): Promise<LedgerCallResult<unknown>> {
  try {
    const { status, body } = await send(buildGetUpdateByIdRequest(parties, updateId));
    return interpretLedgerResponse<unknown>(status, body);
  } catch (error) {
    return {
      ok: false,
      reason: "unreachable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
