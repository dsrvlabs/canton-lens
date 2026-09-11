import type { LedgerFailureReason } from "@canton-lens/core";

// The single chokepoint from LedgerFailureReason -> HTTP status code/body.
// All three handlers (session/contracts/detail) call only this one function on failure.
// When LedgerFailureReason changes, this file must be updated with it — there is no default
// branch, so when a new name is added it surfaces as a compile error (never check).
export function ledgerFailureToHttp(reason: LedgerFailureReason): {
  status: number;
  body: { reason: LedgerFailureReason };
} {
  switch (reason) {
    case "unauthenticated":
      return { status: 401, body: { reason } };
    case "forbidden":
      return { status: 403, body: { reason } };
    case "not_found":
      return { status: 404, body: { reason } };
    case "node_error":
      return { status: 502, body: { reason } };
    case "unreachable":
      return { status: 504, body: { reason } };
    case "offset_after_ledger_end":
      // Well-formed, but a point that has not arrived yet — the caller can fix it, so it is a 400.
      // (The ledger end only moves forward, so the same value may become valid later. That is why the
      //  reason name has to say precisely **what** was wrong — it is not lumped into invalid_offset.)
      return { status: 400, body: { reason } };
    case "pruned":
      // It existed but is no longer retained — 410 Gone.
      return { status: 410, body: { reason } };
    default: {
      const exhaustive: never = reason;
      throw new Error(`unhandled ledger failure reason: ${String(exhaustive)}`);
    }
  }
}
