import type { LedgerVersionResponse } from "../ledger-request/request-get-version.ts";
import type { LedgerCallResult, LedgerFailureReason } from "../ledger-request/types.ts";
import type {
  NodeLiveStatusResult,
  NodeOffsetReading,
} from "../node-live-status/compute-node-live-status.ts";
import { computeInstanceLedgerEndProgress } from "../node-live-status/compute-node-live-status.ts";

// A comparable value such as epoch ms. This layer does not read the current time — it only receives it as an argument.
export type ObservedAtMs = number;

export type NodeElapsed =
  | { case: "since-advance"; ms: number }
  | { case: "since-stall"; ms: number }
  | { case: "regressed-interval"; ms: number }
  | { case: "clock-not-advanced" }
  | { case: "not-yet-known" };

export type NodeVersionFact =
  | { status: "ok"; version: string; features: unknown }
  | { status: "unavailable"; reason: LedgerFailureReason };

// The absence of party/user arguments is the signature-level evidence that this value is an instance-level fact.
export type InstanceNodeStatusSnapshot = {
  progress: NodeLiveStatusResult;
  elapsed: NodeElapsed;
  version: NodeVersionFact;
};

export function buildNodeStatusSnapshot(
  prior: NodeOffsetReading,
  priorObservedAt: ObservedAtMs,
  current: NodeOffsetReading,
  currentObservedAt: ObservedAtMs,
  versionResult: LedgerCallResult<LedgerVersionResponse>,
): InstanceNodeStatusSnapshot {
  const progress = computeInstanceLedgerEndProgress(prior, current);

  let elapsed: NodeElapsed;
  if (
    progress.case === "prior-unavailable" ||
    progress.case === "current-unavailable" ||
    progress.case === "both-unavailable"
  ) {
    elapsed = { case: "not-yet-known" };
  } else if (currentObservedAt <= priorObservedAt) {
    elapsed = { case: "clock-not-advanced" };
  } else {
    const ms = currentObservedAt - priorObservedAt;
    elapsed =
      progress.case === "advanced"
        ? { case: "since-advance", ms }
        : progress.case === "stalled"
          ? { case: "since-stall", ms }
          : { case: "regressed-interval", ms };
  }

  const version: NodeVersionFact = versionResult.ok
    ? { status: "ok", version: versionResult.value.version, features: versionResult.value.features }
    : { status: "unavailable", reason: versionResult.reason };

  return { progress, elapsed, version };
}
