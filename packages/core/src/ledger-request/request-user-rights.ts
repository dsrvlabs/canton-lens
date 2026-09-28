import { interpretLedgerResponse } from "./interpret.ts";
import type { LedgerCallResult, LedgerRequest, LedgerSend } from "./types.ts";

// **This one cannot be asked for in parts either.** The node's OpenAPI gives `/v2/users/{user-id}/rights`
// one path parameter and nothing else, and ListUserRightsResponse carries no next-page token — while the
// participant itself advertises `maxRightsPerUser` (1000 by default), well above the JSON API's list limit.
// It is the worst placed of the unpaged calls: the viewer is resolved on nearly every request, so a user over
// the limit cannot load any screen. The failure is named (too_many_elements); docs/deployment.md states the
// condition and the remedy.
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
