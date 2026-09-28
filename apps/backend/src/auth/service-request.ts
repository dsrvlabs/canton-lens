import type { LedgerSend } from "@canton-lens/core";
import { withAuth } from "../ledger-send-with-token.ts";
import { type ServiceTokenProvider, SHARED_IDENTITY_UNAVAILABLE } from "./service-token.ts";

// The one part of a ledger error body that leaves this boundary: the error name. Anything else the body
// holds — `cause` above all, which the node writes as prose around the values it was given — is dropped by
// returning an object carrying `code` alone. A body that is not an object, or that has no string `code`,
// becomes null exactly as before.
const errorName = (body: unknown): { code: string } | null =>
  typeof body === "object" && body !== null && typeof (body as { code?: unknown }).code === "string"
    ? { code: (body as { code: string }).code }
    : null;

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
    // Error bodies are not needed to classify a transport failure, and the rest of one is the node's own
    // prose — it can carry element counts, party ids and offsets, so it is never propagated.
    //
    // **`code` is the exception, and it is kept.** Four of the failures interpret.ts names arrive as a
    // JsCantonError name rather than as a status code (PRUNED · OFFSET_AFTER_LEDGER_END · UPDATE_NOT_FOUND ·
    // JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED). Dropping the whole body left interpret.ts nothing to
    // read them from, so under shared identity all four collapsed into node_error and a pruned past, a point
    // not yet reached and a list past the node's limit were each reported as “the node refused”. The name is
    // a fixed term from the node's own error taxonomy, not caller data and not a value from the request, so
    // carrying it forward tells the caller nothing the reason name does not already say.
    return response.status >= 400
      ? { status: response.status, body: errorName(response.body) }
      : response;
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
