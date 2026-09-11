import type { LedgerSend } from "@canton-lens/core";
import { withAuth } from "../ledger-send-with-token.ts";
import { type ServiceTokenProvider, SHARED_IDENTITY_UNAVAILABLE } from "./service-token.ts";

// Track failures at transport level: some read-only routes return partial results with HTTP 200.
// A service credential failure must still be operational, never hidden inside partial data.
export function serviceRequest(provider: ServiceTokenProvider, ledgerSend: LedgerSend) {
  let unavailable = false;
  let forbidden = false;
  const send: LedgerSend = async (request) => {
    if (unavailable) return { status: 401, body: null };
    let token: Awaited<ReturnType<ServiceTokenProvider["get"]>>;
    try {
      token = await provider.get();
    } catch {
      unavailable = true;
      return { status: 401, body: null };
    }
    const response = await ledgerSend(withAuth(request, token.value));
    if (response.status === 401) {
      provider.invalidate(token);
      unavailable = true;
    }
    if (response.status === 403) forbidden = true;
    // Error bodies are not needed to classify a transport failure. Never propagate them.
    return response.status >= 400 ? { status: response.status, body: null } : response;
  };
  return {
    send,
    failure: () =>
      unavailable
        ? { status: 503, body: { reason: SHARED_IDENTITY_UNAVAILABLE } }
        : forbidden
          ? { status: 403, body: { reason: "shared_identity_forbidden" } }
          : null,
  };
}
