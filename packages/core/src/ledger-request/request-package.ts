import { interpretLedgerResponse } from "./interpret.ts";
import type { LedgerCallResult, LedgerRequest, LedgerSend } from "./types.ts";

// Downloads a single package — `GET /v2/packages/{package-id}` returns **ArchivePayload** bytes as application/octet-stream
// (Canton 3.4 OpenAPI; the hash is in the `Canton-Package-Hash` header). This is the input to reading the contract blueprint (decoder). Since the response is not JSON,
// responseType: "bytes" — the sender (serve.mjs) sees that, receives it as an arrayBuffer, and returns a Uint8Array.
export function buildGetPackageRequest(packageId: string): LedgerRequest {
  return {
    method: "GET",
    path: `/v2/packages/${encodeURIComponent(packageId)}`,
    responseType: "bytes",
  };
}

export async function callGetPackage(
  send: LedgerSend,
  packageId: string,
): Promise<LedgerCallResult<Uint8Array>> {
  try {
    const { status, body } = await send(buildGetPackageRequest(packageId));
    const result = interpretLedgerResponse<unknown>(status, body);
    if (!result.ok) return result;
    if (!(result.value instanceof Uint8Array)) {
      return { ok: false, reason: "node_error", detail: "package response was not bytes" };
    }
    return { ok: true, value: result.value };
  } catch (error) {
    return {
      ok: false,
      reason: "unreachable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
