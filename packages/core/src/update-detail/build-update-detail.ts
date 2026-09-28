// Update detail — one point lookup (LEDGER_EFFECTS) response
// into the shape the screen draws. Header (update id · offset · effectiveAt · recordTime · workflowId · synchronizer ·
// the hash to be signed on a separate row · Submitted by you) · event table (Created / Exercised·consuming · template/choice · arguments as Raw
// JSON · witnessParties · contract ids linked only for created ones) · “why I can see this” (which events my parties are involved in).
//
// The events keep the order the node sent them in — pre-order over the transaction's nodes — and each one carries where it
// sits in that tree (tree: depth · ancestorIndex · descendantCount, from nest-update-events.ts). The list is not re-sorted
// and nothing is grouped: a reader who ignores `tree` reads exactly the flat list this returned before.
//
// Reassignment is not accepted in v1 — if one arrives via the point lookup, it is not silently skipped; `kind:"reassignment"` says “not in this
// version” rather than silently skipping it. TopologyTransaction·OffsetCheckpoint are treated the same.
//

import { isRecord, isStringArray } from "../internal/guards.ts";
import { parseTemplateFqn } from "../template-identifier/parse-template-identifier.ts";
import {
  explainVisibility,
  type VisibilityReason,
  type VisibilityRole,
} from "../visibility/explain-visibility.ts";
import { nestUpdateEvents, type UpdateEventPlacement } from "./nest-update-events.ts";

export type UpdateDetailEvent = {
  kind: "created" | "exercised";
  nodeId: number | null;
  // exercised only — the last node id of everything that happened under this exercise. Equal to nodeId when
  // nothing did. A created event has no subtree, so null.
  lastDescendantNodeId: number | null;
  // **Where the viewer stands on this event**, party by party — the same judgment the update's "visible to you
  // because" line folds, kept per event so a row can say it without the reader counting event numbers off a
  // sentence. Empty when none of their parties is named here, and empty for a viewer who holds no party of
  // their own (a super reader reads as every party and is none of them).
  yours: VisibilityReason[];
  // Where this event sits in the tree of the events shown — derived here (nestUpdateEvents), not sent by the node.
  tree: UpdateEventPlacement;
  // **created only — the parties this create was divulged to.** A Create node's informees are exactly its
  // stakeholders (signatories ∪ observers), so a party in witnessParties beyond them is not there because it
  // stands on the contract: it is an informee of some node above this one, and that node's subtree opened for
  // it. That is divulgence, and a divulged contract can be read but not spent — it never enters an active set.
  //
  // **null on an exercised event, because this response cannot decide it.** An Exercise node's informees are
  // the target contract's signatories ∪ the choice's controllers ∪ its choice observers (∪ the target's
  // observers when consuming), and of those the response carries only the acting parties. Answering
  // "divulged" there would mean guessing at the rest.
  divulgedTo: string[] | null;
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
        | { status: "no_party_found" }
        // The viewer holds no party of their own — a super reader reading as all of them. Separate from
        // no_party_found, which says a match was looked for and not found.
        | { status: "no_own_parties" };
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

  // The tree placement and the viewer's standing are read off the whole list, so the events are gathered
  // first and both are stamped on after.
  const drafts: Omit<UpdateDetailEvent, "tree" | "yours">[] = [];
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
    drafts.push({
      kind: created ? "created" : "exercised",
      nodeId: typeof source.nodeId === "number" ? source.nodeId : null,
      lastDescendantNodeId:
        exercised && typeof exercised.lastDescendantNodeId === "number"
          ? exercised.lastDescendantNodeId
          : null,
      divulgedTo: created
        ? witnessParties.filter(
            (party) =>
              !(isStringArray(created.signatories) ? created.signatories : []).includes(party) &&
              !(isStringArray(created.observers) ? created.observers : []).includes(party),
          )
        : null,
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

  const placements = nestUpdateEvents(drafts);
  // Asked once per event, and read twice: the row says it, and the fold below gathers it per party.
  const explainedPerEvent = drafts.map((draft) =>
    explainVisibility(viewerParties, {
      signatories: draft.signatories ?? [],
      observers: draft.observers ?? [],
      witnessParties: draft.witnessParties,
      // An exercised event's acting parties are its controllers, and a controller is an informee of that node
      // by the exercise itself. Without them my own party fell through to "witness", which says the opposite.
      actingParties: draft.actingParties ?? [],
    }),
  );
  const events: UpdateDetailEvent[] = drafts.map((draft, index) => ({
    ...draft,
    // One placement per event, in the same order — the root is the answer for a list that could not be nested.
    tree: placements[index] ?? { depth: 0, ancestorIndex: null, descendantCount: 0 },
    yours: explainedPerEvent[index]?.status === "ok" ? explainedPerEvent[index].reasons : [],
  }));

  // “Why I can see this” — for each event, ask the role of my parties and gather per party.
  //
  // **witnessParties in LEDGER_EFFECTS are cumulative informees**: the informees of that node and of every node
  // above it. So the witness role does not say "informee of this node" — it says "an informee of this node or
  // of one above it, and not a stakeholder here". On a created event that difference is exactly divulgence
  // (see divulgedTo); on an exercised event it cannot be told apart from this response alone.
  const byParty = new Map<string, UpdateVisibilityReason>();
  events.forEach((event, index) => {
    for (const reason of event.yours) {
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
      // Folding per event loses which of the two empty outcomes it was, so the distinction is made on the
      // same input explainVisibility judges: no parties of one's own is not a search that came back empty.
      visibility:
        reasons.length > 0
          ? { status: "ok", reasons }
          : viewerParties.length === 0
            ? { status: "no_own_parties" }
            : { status: "no_party_found" },
    },
  };
}
