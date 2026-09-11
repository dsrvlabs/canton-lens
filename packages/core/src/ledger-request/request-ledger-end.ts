import { interpretLedgerResponse } from "./interpret.ts";
import type { LedgerCallResult, LedgerRequest, LedgerSend } from "./types.ts";

export function buildGetLedgerEndRequest(): LedgerRequest {
  return { method: "GET", path: "/v2/state/ledger-end" };
}

export async function callGetLedgerEnd(send: LedgerSend): Promise<LedgerCallResult<unknown>> {
  const request = buildGetLedgerEndRequest();
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
