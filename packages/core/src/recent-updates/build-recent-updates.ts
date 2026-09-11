// Layer 1 (Ledger API v2 JSON) updates response -> “What happened recently” screen rows.
//
// This screen says what the ACS (current state) cannot — contracts that **disappeared**. An offer that was accepted
// and archived is nowhere in the contract list, and only here does it leave a trace.
//
// It is “recent”, not “all”. The input is only the updates of the recent window (begin, end], and the past the participant
// has pruned never arrives in the first place. Older history is not served.
// This function does not re-judge that boundary — it only sorts and cuts what it received.

import { isStringArray } from "../internal/guards.ts";
import { parseTemplateFqn } from "../template-identifier/parse-template-identifier.ts";

// Requires only the minimum fields this function actually uses. Others such as nodeId are not put in the type —
// ignored even if they come in. parties is the value with which the screen draws “who is involved”: for created it is
// signatories ∪ observers, and for archived it is witnessParties since the ledger does not give the former
// (they are not the same value — the name is not swapped; the envelope knows which one it is and fills it in).
export type UpdateEventEntry = {
  kind: "created" | "archived";
  contractId: string;
  templateId: string;
  parties: string[];
  // “The requested parties that see this event” — the material for the party filter judgment (Transactions screen rule: the field
  // judged for a party match is witnessParties. Archived has no signatories/observers). If absent, undefined rather than an empty array.
  witnessParties?: string[];
};

export type UpdateEntry = {
  updateId: string;
  offset: number;
  effectiveAt: string;
  events: UpdateEventEntry[];
  // commandId is **a field that only reaches the submitting party** (Ledger API proto). If it has a value, this update was submitted by me.
  commandId?: string;
};

export type RecentUpdateEventRow = {
  kind: "created" | "archived";
  contractId: string;
  // In substance this is the packageId (hex). Not the human-readable packageName (the same rule as contract-list).
  package: string;
  module: string;
  entity: string;
  parties: string[];
  witnessParties: string[];
};

export type RecentUpdateRow = {
  updateId: string;
  offset: number;
  effectiveAt: string;
  events: RecentUpdateEventRow[];
  // The basis for the “Submitted by you” text chip. The judgment is in this one place — true if commandId is not empty.
  // A signal that a public explorer cannot have in principle (a field that only reaches the submitting party).
  submittedByYou: boolean;
};

export type BuildRecentUpdatesResult =
  | { ok: true; rows: RecentUpdateRow[] }
  | { ok: false; reason: string };

const DEFAULT_LIMIT = 20;

export const RECENT_UPDATES_DEFAULT_LIMIT = DEFAULT_LIMIT;

export function buildRecentUpdates(
  entries: unknown,
  opts?: { limit?: number },
): BuildRecentUpdatesResult {
  if (!Array.isArray(entries)) {
    // The lookup itself failed (structural anomaly) — unavailable. Not glossed over with 0/[]/null.
    return { ok: false, reason: "updates_not_array" };
  }
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) {
    return { ok: false, reason: "invalid_limit" };
  }

  const rows: RecentUpdateRow[] = [];
  for (const raw of entries) {
    const entry = raw as Partial<UpdateEntry>;
    if (
      typeof entry?.updateId !== "string" ||
      typeof entry?.offset !== "number" ||
      typeof entry?.effectiveAt !== "string" ||
      !Array.isArray(entry?.events)
    ) {
      // Structural errors are not partially skipped — so that untrustworthy input is not silently dropped.
      return { ok: false, reason: "malformed_update" };
    }

    const events: RecentUpdateEventRow[] = [];
    for (const rawEvent of entry.events) {
      const event = rawEvent as Partial<UpdateEventEntry>;
      if (
        (event?.kind !== "created" && event?.kind !== "archived") ||
        typeof event?.contractId !== "string" ||
        typeof event?.templateId !== "string" ||
        !isStringArray(event?.parties)
      ) {
        return { ok: false, reason: "malformed_event" };
      }
      const parsed = parseTemplateFqn(event.templateId);
      if (!parsed.ok) {
        return { ok: false, reason: `template_parse_failed:${parsed.reason}` };
      }
      events.push({
        kind: event.kind,
        contractId: event.contractId,
        package: parsed.package_name,
        module: parsed.module_name,
        entity: parsed.entity_name,
        parties: event.parties,
        witnessParties: isStringArray(event.witnessParties) ? event.witnessParties : [],
      });
    }

    // An update with no events visible to me does not become a row — an empty row has nothing to say on the screen.
    if (events.length === 0) continue;
    rows.push({
      updateId: entry.updateId,
      offset: entry.offset,
      effectiveAt: entry.effectiveAt,
      events,
      submittedByYou: typeof entry.commandId === "string" && entry.commandId !== "",
    });
  }

  // Most recent on top. offset is a total order within the participant, so it alone is used for sorting.
  rows.sort((a, b) => b.offset - a.offset);
  return { ok: true, rows: rows.slice(0, limit) };
}
