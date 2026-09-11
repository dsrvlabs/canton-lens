import type { LedgerFailureReason } from "../ledger-request/types.ts";
// A minimal module handling only offset reachability and progress for the node's live status.
//
// This function handles the layer 1 (Ledger API) instance-level facts.
// There is no per-party stakeholder judgment — being an instance-level fact, there is nothing to pass through the visibility chokepoint.
//
// Only pure functions are defined. The ledger call itself is not this module's responsibility —
// callGetLedgerEnd in the existing ledger-request/request-ledger-end.ts handles it.
// This module goes only as far as comparing the offset readings from two points in time.
//
// NodeOffsetReading has the same value set as LedgerFailureReason in ledger-request/types.ts
// (unauthenticated/forbidden/not_found/node_error/unreachable), but the substance of its failure causes
// differs from a lag-side OffsetReading (source-missing/query-failed), which a stored-history source would need,
// so it is declared separately. They are not reused for each other.
//
// The caller (the future apps layer, outside this execution's scope) calls callGetLedgerEnd at two points in time
// and maps the resulting LedgerCallResult<unknown> to this type by the following rule:
//   ok  -> { status: "ok", offset: value.offset }
//   failure -> { status: "unavailable", reason: <LedgerFailureReason as-is> }
// This mapping (parsing) itself is not implemented by this module — extracting the offset field from
// unknown is a separate validation responsibility and outside the scope of this minimal deliverable.

export type NodeOffsetReading =
  | { status: "ok"; offset: number }
  | {
      status: "unavailable";
      reason: LedgerFailureReason;
    };

export type NodeLiveStatusResult =
  | { case: "advanced"; delta: number }
  | { case: "stalled" }
  | { case: "regressed"; delta: number }
  | { case: "prior-unavailable" }
  | { case: "current-unavailable" }
  | { case: "both-unavailable" };

// delta = current.offset - prior.offset. It does not measure time and takes no party/user
// arguments — the signature proves that this judgment is an instance-level fact.
export function computeInstanceLedgerEndProgress(
  prior: NodeOffsetReading,
  current: NodeOffsetReading,
): NodeLiveStatusResult {
  const priorUnavailable = prior.status === "unavailable";
  const currentUnavailable = current.status === "unavailable";

  if (priorUnavailable && currentUnavailable) {
    return { case: "both-unavailable" };
  }
  if (priorUnavailable) {
    return { case: "prior-unavailable" };
  }
  if (currentUnavailable) {
    return { case: "current-unavailable" };
  }

  const delta =
    (current as { status: "ok"; offset: number }).offset -
    (prior as { status: "ok"; offset: number }).offset;

  if (delta > 0) {
    return { case: "advanced", delta };
  }
  if (delta < 0) {
    return { case: "regressed", delta };
  }
  return { case: "stalled" };
}
