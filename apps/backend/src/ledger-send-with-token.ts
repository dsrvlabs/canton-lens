// A thin function that attaches the explicitly supplied Canton Bearer token to a ledger request.
// core's LedgerRequest type has no auth header field (filling in headers is the responsibility of
// the LedgerSend implementation — see the comment in packages/core/src/ledger-request/types.ts).
// So this function emits the LedgerRequest with an authorization field laid on top, and
// the actual transport (building HTTP headers etc.) is handled by the caller (deps.send, i.e. the live
// implementation or a test double) reading that field.
//
// This helper neither acquires nor retains credentials. Caller-bearer uses a user's token from
// Browser PKCE memory or an institution server during the request only. In shared-identity,
// the transport supplies the separate Backend-managed service token. No exchange or fallback occurs here.
import type { LedgerRequest } from "@canton-lens/core";

export type AuthorizedLedgerRequest = LedgerRequest & { authorization: string };

export function withAuth(request: LedgerRequest, ledgerToken: string): AuthorizedLedgerRequest {
  return { ...request, authorization: `Bearer ${ledgerToken}` };
}
