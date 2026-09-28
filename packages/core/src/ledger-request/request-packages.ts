import { interpretLedgerResponse } from "./interpret.ts";
import type { LedgerCallResult, LedgerRequest, LedgerSend } from "./types.ts";

// **This one cannot be asked for in parts.** The node's OpenAPI gives `/v2/packages` two query parameters,
// `vetAllPackages` and `synchronizerId`, and no limit, page token or cursor — so a participant that vets more
// packages than its `http-list-max-elements-limit` answers 413 and there is nothing this layer can do about
// it. The failure is named (too_many_elements) rather than reported as “the node refused”, and the condition
// and its remedy are written down in docs/deployment.md.
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
