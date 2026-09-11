import { interpretLedgerResponse } from "./interpret.ts";
import type { LedgerCallResult, LedgerRequest, LedgerSend } from "./types.ts";

// /v2/version, as measured: it gives only version and features.
// participant id / Splice version / recent throughput are not in this response.
export type LedgerVersionResponse = { version: string; features: unknown };

export function buildGetVersionRequest(): LedgerRequest {
  return { method: "GET", path: "/v2/version" };
}

export async function callGetVersion(
  send: LedgerSend,
): Promise<LedgerCallResult<LedgerVersionResponse>> {
  const request = buildGetVersionRequest();
  try {
    const { status, body } = await send(request);
    return interpretLedgerResponse<LedgerVersionResponse>(status, body);
  } catch (error) {
    return {
      ok: false,
      reason: "unreachable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
