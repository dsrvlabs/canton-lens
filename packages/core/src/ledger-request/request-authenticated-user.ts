import { interpretLedgerResponse } from "./interpret.ts";
import type { LedgerCallResult, LedgerRequest, LedgerSend } from "./types.ts";

export function buildGetAuthenticatedUserRequest(): LedgerRequest {
  return { method: "GET", path: "/v2/authenticated-user" };
}

export async function callGetAuthenticatedUser(
  send: LedgerSend,
): Promise<LedgerCallResult<unknown>> {
  const request = buildGetAuthenticatedUserRequest();
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
