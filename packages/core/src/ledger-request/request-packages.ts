import { interpretLedgerResponse } from "./interpret.ts";
import type { LedgerCallResult, LedgerRequest, LedgerSend } from "./types.ts";

export function buildListPackagesRequest(): LedgerRequest {
  return { method: "GET", path: "/v2/packages" };
}

export async function callListPackages(send: LedgerSend): Promise<LedgerCallResult<unknown>> {
  const request = buildListPackagesRequest();
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
