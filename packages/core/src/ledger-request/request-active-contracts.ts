import { interpretLedgerResponse } from "./interpret.ts";
import type { LedgerCallResult, LedgerRequest, LedgerSend } from "./types.ts";

// The party scope is given only via filter.filtersByParty. No other global filter keys are placed in the body.
export function buildGetActiveContractsRequest(
  parties: readonly string[],
  offset: number,
  interfaceId?: string,
): LedgerRequest {
  const cumulativeEntry: unknown =
    interfaceId === undefined
      ? { identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }
      : {
          identifierFilter: {
            InterfaceFilter: {
              value: { interfaceId, includeInterfaceView: true, includeCreatedEventBlob: false },
            },
          },
        };

  const filtersByParty: Record<string, { cumulative: unknown[] }> = {};
  for (const party of parties) {
    filtersByParty[party] = { cumulative: [cumulativeEntry] };
  }

  return {
    method: "POST",
    path: "/v2/state/active-contracts",
    body: {
      filter: { filtersByParty },
      verbose: true,
      activeAtOffset: offset,
    },
  };
}

export async function callGetActiveContracts(
  send: LedgerSend,
  parties: readonly string[],
  offset: number,
  interfaceId?: string,
): Promise<LedgerCallResult<unknown>> {
  const request = buildGetActiveContractsRequest(parties, offset, interfaceId);
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
