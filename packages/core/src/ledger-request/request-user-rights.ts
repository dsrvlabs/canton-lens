import { interpretLedgerResponse } from "./interpret.ts";
import type { LedgerCallResult, LedgerRequest, LedgerSend } from "./types.ts";

export function buildListUserRightsRequest(userId: string): LedgerRequest {
  return { method: "GET", path: `/v2/users/${encodeURIComponent(userId)}/rights` };
}

export async function callListUserRights(
  send: LedgerSend,
  userId: string,
): Promise<LedgerCallResult<unknown>> {
  const request = buildListUserRightsRequest(userId);
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
