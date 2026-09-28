import { interpretLedgerResponse } from "./interpret.ts";
import { updateFormatLedgerEffects } from "./request-update-by-id.ts";
import type { LedgerCallResult, LedgerPartyFilter, LedgerRequest, LedgerSend } from "./types.ts";

// Point lookup of a single update by offset (`POST /v2/updates/update-by-offset`). This is where the “creating update”
// link in Contracts detail lands — the ACS gives only createdEvent.offset, not an update id, and the creation of an old contract is almost always
// outside the “recent window”, so a window scan would produce a dead link.
export function buildGetUpdateByOffsetRequest(
  filter: LedgerPartyFilter,
  offset: number,
): LedgerRequest {
  return {
    method: "POST",
    path: "/v2/updates/update-by-offset",
    body: { offset, updateFormat: updateFormatLedgerEffects(filter) },
  };
}

export async function callGetUpdateByOffset(
  send: LedgerSend,
  filter: LedgerPartyFilter,
  offset: number,
): Promise<LedgerCallResult<unknown>> {
  // **Built outside the catch.** Building a request is not sending one, so a caller-contract error here
  // (a filter that is neither shape) must not be reported as `unreachable` — the node was never asked.
  const request = buildGetUpdateByOffsetRequest(filter, offset);
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
