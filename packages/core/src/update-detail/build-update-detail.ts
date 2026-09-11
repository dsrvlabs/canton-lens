// Update detail — one point lookup (LEDGER_EFFECTS) response
// into the shape the screen draws. Header (update id · offset · effectiveAt · recordTime · workflowId · synchronizer ·
// the hash to be signed on a separate row · Submitted by you) · event table (Created / Exercised·consuming · template/choice · arguments as Raw
// JSON · witnessParties · contract ids linked only for created ones) · “why I can see this” (which events my parties are involved in).
//
// Reassignment is not accepted in v1 — if one arrives via the point lookup, it is not silently skipped; `kind:"reassignment"` says “not in this
// version” rather than silently skipping it. TopologyTransaction·OffsetCheckpoint are treated the same.
//

import { isRecord, isStringArray } from "../internal/guards.ts";
import { parseTemplateFqn } from "../template-identifier/parse-template-identifier.ts";
import { explainVisibility, type VisibilityRole } from "../visibility/explain-visibility.ts";

export type UpdateDetailEvent = {
  kind: "created" | "exercised";
  nodeId: number | null;
  contractId: string;
  templateId: string;
  package: string;
  module: string;
  entity: string;
  packageName: string | null;
  witnessParties: string[];
  // created only
  signatories: string[] | null;
  observers: string[] | null;
  // **It may be absent.** Holding `undefined` makes the key disappear when serialized to JSON, so the type
  // says so too. Declared required, that lie would be carried straight into the openapi document, and an
  // exercised-event response would violate its own contract.
  // “The value is null” and “the key is absent” are different statements — a created-only field is the latter.
  createArgument?: unknown;
  // exercised only
  choice: string | null;
  consuming: boolean | null;
  // Optional for the same reason as above. If it is not an exercised event, the key is absent.
  choiceArgument?: unknown;
  exerciseResult?: unknown;
  actingParties: string[] | null;
  interfaceId: string | null;
};

export type UpdateDetailHeader = {
  updateId: string;
  offset: number;
  effectiveAt: string | null;
  recordTime: string | null;
  workflowId: string | null;
  synchronizerId: string | null;
  // The hash to be signed — not displayed merged with the update id (v1 “Three things we will not hide” ②). null if absent.
  externalTransactionHash: string | null;
  submittedByYou: boolean;
};

// In which events, and in what role, my parties are involved such that this update is visible to me.
export type UpdateVisibilityReason = {
  party: string;
  roles: VisibilityRole[];
  eventIndexes: number[];
};

export type UpdateDetailView =
  | {
      kind: "transaction";
      header: UpdateDetailHeader;
      events: UpdateDetailEvent[];
      visibility:
        | { status: "ok"; reasons: UpdateVisibilityReason[] }
        | { status: "no_party_found" };
    }
  | {
      kind: "reassignment" | "topology" | "checkpoint";
      updateId: string | null;
      offset: number | null;
    };

export type BuildUpdateDetailResult =
  | { ok: true; view: UpdateDetailView }
  | { ok: false; reason: string };

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

export function buildUpdateDetail(
  raw: unknown,
  viewerParties: readonly string[],
): BuildUpdateDetailResult {
  if (!isRecord(raw) || !isRecord(raw.update))
    return { ok: false, reason: "update_shape_mismatch" };
  const u = raw.update;
  const other = (
    kind: "reassignment" | "topology" | "checkpoint",
    wrapped: unknown,
  ): BuildUpdateDetailResult => {
    const value = isRecord(wrapped) && isRecord(wrapped.value) ? wrapped.value : {};
    return {
      ok: true,
      view: {
        kind,
        updateId: str(value.updateId),
        offset: typeof value.offset === "number" ? value.offset : null,
      },
    };
  };
  if (isRecord(u.Reassignment)) return other("reassignment", u.Reassignment);
  if (isRecord(u.TopologyTransaction)) return other("topology", u.TopologyTransaction);
  if (isRecord(u.OffsetCheckpoint)) return other("checkpoint", u.OffsetCheckpoint);
  if (!isRecord(u.Transaction)) return { ok: false, reason: "update_kind_unknown" };
  const value = isRecord(u.Transaction.value) ? u.Transaction.value : u.Transaction;
  if (
    typeof value.updateId !== "string" ||
    typeof value.offset !== "number" ||
    !Array.isArray(value.events)
  ) {
    return { ok: false, reason: "transaction_shape_mismatch" };
  }

  const events: UpdateDetailEvent[] = [];
  for (const rawEvent of value.events) {
    if (!isRecord(rawEvent)) return { ok: false, reason: "event_shape_mismatch" };
    const created = isRecord(rawEvent.CreatedEvent) ? rawEvent.CreatedEvent : null;
    const exercised = isRecord(rawEvent.ExercisedEvent) ? rawEvent.ExercisedEvent : null;
    // LEDGER_EFFECTS has no ArchivedEvent (an archive arrives as a consuming exercise). Any other kind is a shape mismatch.
    const source = created ?? exercised;
    if (
      source === null ||
      typeof source.contractId !== "string" ||
      typeof source.templateId !== "string"
    ) {
      return { ok: false, reason: "event_shape_mismatch" };
    }
    const parsed = parseTemplateFqn(source.templateId);
    if (!parsed.ok) return { ok: false, reason: `template_parse_failed:${parsed.reason}` };
    const witnessParties = isStringArray(source.witnessParties) ? source.witnessParties : [];
    events.push({
      kind: created ? "created" : "exercised",
      nodeId: typeof source.nodeId === "number" ? source.nodeId : null,
      contractId: source.contractId,
      templateId: source.templateId,
      package: parsed.package_name,
      module: parsed.module_name,
      entity: parsed.entity_name,
      packageName: str(source.packageName),
      witnessParties,
      signatories: created && isStringArray(created.signatories) ? created.signatories : null,
      observers: created && isStringArray(created.observers) ? created.observers : null,
      // Spread conditionally — writing `undefined` explicitly is rejected by exactOptionalPropertyTypes,
      // and more importantly this lets the type say "the key is absent".
      ...(created ? { createArgument: created.createArgument } : {}),
      choice: exercised ? str(exercised.choice) : null,
      consuming: exercised && typeof exercised.consuming === "boolean" ? exercised.consuming : null,
      ...(exercised
        ? { choiceArgument: exercised.choiceArgument, exerciseResult: exercised.exerciseResult }
        : {}),
      actingParties:
        exercised && isStringArray(exercised.actingParties) ? exercised.actingParties : null,
      interfaceId: exercised ? str(exercised.interfaceId) : null,
    });
  }

  // “Why I can see this” — for each event, ask the role of my parties and gather per party. exercised has no signatories/observers,
  // so witnessParties alone qualifies as the witness role — a witness in LEDGER_EFFECTS is an informee.
  const byParty = new Map<string, UpdateVisibilityReason>();
  events.forEach((event, index) => {
    const explained = explainVisibility(viewerParties, {
      signatories: event.signatories ?? [],
      observers: event.observers ?? [],
      witnessParties: event.witnessParties,
    });
    if (explained.status !== "ok") return;
    for (const reason of explained.reasons) {
      const entry = byParty.get(reason.party) ?? {
        party: reason.party,
        roles: [],
        eventIndexes: [],
      };
      for (const role of reason.roles) if (!entry.roles.includes(role)) entry.roles.push(role);
      entry.eventIndexes.push(index);
      byParty.set(reason.party, entry);
    }
  });
  const reasons = Array.from(byParty.values());

  return {
    ok: true,
    view: {
      kind: "transaction",
      header: {
        updateId: value.updateId,
        offset: value.offset,
        effectiveAt: str(value.effectiveAt),
        recordTime: str(value.recordTime),
        workflowId: str(value.workflowId),
        synchronizerId: str(value.synchronizerId),
        externalTransactionHash: str(value.externalTransactionHash),
        submittedByYou: str(value.commandId) !== null,
      },
      events,
      visibility: reasons.length === 0 ? { status: "no_party_found" } : { status: "ok", reasons },
    },
  };
}
