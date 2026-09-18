// **GET /api/updates/{updateId} and /api/updates/by-offset/{offset}, written out again by hand.**
//
// One transaction, opened. A point lookup in LEDGER_EFFECTS, which is a different reading of the ledger from
// the one the lists use: there is no ArchivedEvent here — an archive arrives as a *consuming exercise* — and
// witnessParties is present, which is why "why can I see this" has a third capacity here and only two in the
// contract list.
//
// **Three sentences about visibility, and they are not interchangeable:**
//   · ok, with the parties of mine that appear and in which events;
//   · no_party_found — I hold parties, we looked, and none of them appears. The material is lacking, and
//     saying "not visible" instead would be inventing a fact about a thing that reached me;
//   · no_own_parties — I hold no party at all. A super reader reads as every party and is party to none, so
//     there is no list to intersect and the question does not apply. Reporting a failed search there would
//     read as "the material is lacking" about material that is complete.
//
// Both addresses are answered by these same rules: the two differ only in what the node is asked, and the
// answer to "what is this update" cannot depend on how it was named.
//
// Written by reading router.ts, core/update-detail/build-update-detail.ts and
// core/visibility/explain-visibility.ts.
import {
  ABSENT,
  app,
  type Branches,
  buildObject,
  type CheckContext,
  type Expectation,
  type Mapping,
  node,
  type Rule,
  unjudged,
} from "../mapping.ts";
import { arr, fqn, myParties, num, rec, str, stringsOf } from "./read-trace.ts";

// ── One event ────────────────────────────────────────────────────────────────────

/** A created or an exercised node of the transaction, with which of the two it is kept apart. */
type Event = {
  created: Record<string, unknown> | null;
  exercised: Record<string, unknown> | null;
  source: Record<string, unknown>;
};

const isCreated = (e: Event): boolean => e.created !== null;

const EVENT: Record<string, Rule<Event>> = {
  kind: app(
    "created when the node's event is a CreatedEvent, exercised when it is an ExercisedEvent. There is no archived here: in this reading an archive is a consuming exercise",
    (e) => (isCreated(e) ? "created" : "exercised"),
  ),
  nodeId: app("the node's nodeId, or null when it sent none that is a number", (e) =>
    num(e.source.nodeId),
  ),
  contractId: node("source.contractId"),
  templateId: node("source.templateId"),
  package: app(
    "the first of the three colon-separated parts of the templateId",
    (e) => fqn(e.source.templateId)?.[0],
  ),
  module: app("the second of the three parts", (e) => fqn(e.source.templateId)?.[1]),
  entity: app("the third of the three parts", (e) => fqn(e.source.templateId)?.[2]),
  packageName: app("the node's packageName, or null when it sent none or sent an empty one", (e) =>
    str(e.source.packageName) === "" ? null : str(e.source.packageName),
  ),
  witnessParties: app(
    "the node's witnessParties, or an empty list — in this reading a witness is an informee",
    (e) => stringsOf(e.source.witnessParties),
  ),
  signatories: app(
    "a created event's signatories; null for an exercised one, which carries none",
    (e) => (e.created === null ? null : stringsOf(e.created.signatories)),
  ),
  observers: app("a created event's observers; null for an exercised one", (e) =>
    e.created === null ? null : stringsOf(e.created.observers),
  ),
  // **Absent, not null.** "The key is not there" and "the value is null" are different answers, and a
  // created-only field on an exercised event is the first.
  createArgument: app(
    "a created event's argument, copied untouched; the key is absent otherwise",
    (e) => (e.created === null ? ABSENT : e.created.createArgument),
  ),
  choice: app("an exercised event's choice name, or null", (e) =>
    e.exercised === null ? null : (str(e.exercised.choice) ?? null),
  ),
  consuming: app("whether that exercise consumes the contract, or null", (e) =>
    e.exercised === null || typeof e.exercised.consuming !== "boolean"
      ? null
      : e.exercised.consuming,
  ),
  choiceArgument: app(
    "an exercised event's argument, copied untouched; the key is absent otherwise",
    (e) => (e.exercised === null ? ABSENT : e.exercised.choiceArgument),
  ),
  exerciseResult: app(
    "what the choice returned, copied untouched; the key is absent otherwise",
    (e) => (e.exercised === null ? ABSENT : e.exercised.exerciseResult),
  ),
  actingParties: app("who exercised it, or null for a created event", (e) =>
    e.exercised === null ? null : stringsOf(e.exercised.actingParties),
  ),
  interfaceId: app("the interface the choice was exercised through, or null", (e) =>
    e.exercised === null ? null : (str(e.exercised.interfaceId) ?? null),
  ),
  // The three the decoder fills in. A second decoder is not a check — see mappings/package-schema.ts.
  templateSchema: unjudged(
    "the field names and types of a template are what the package bytes decode to",
  ),
  choiceSchema: unjudged("a choice's signature is what the package bytes decode to"),
  schemaStatus: unjudged("whether that package decoded, and why not when it did not"),
};

// ── Why I can see it ─────────────────────────────────────────────────────────────

type Reason = { party: string; roles: string[]; eventIndexes: number[] };

const VISIBILITY_REASON: Record<string, Rule<Reason>> = {
  party: app("one of my parties, in the order my rights list them", (r) => r.party),
  // **The tape does not exercise the last clause.** Letting a stakeholder be reported as a witness too
  // changes nothing in the recorded answers: no party of mine is both in the same event. The sentence stays
  // as written, and "a signatory who is also listed as a witness" joins the data conditions the seed owes.
  roles: app(
    "signatory and observer where that party is among them, in that order; witness only when it is neither and the node lists it as a witness — a stakeholder is not also reported as a witness",
    (r) => r.roles,
  ),
  // The observer role is never taken in the tape: every party of mine that appears in an opened update is a
  // signatory or a witness. One more data condition the seed owes (2026-09-18 codex).
  eventIndexes: app(
    "which events of this transaction it appears in, by position, in order — one entry per appearance",
    (r) => r.eventIndexes,
  ),
};

// ── The header ───────────────────────────────────────────────────────────────────

const HEADER: Record<string, Rule<Record<string, unknown>>> = {
  updateId: node("updateId"),
  offset: node("offset"),
  effectiveAt: app("the node's effectiveAt, or null when it sent none or sent an empty one", (v) =>
    str(v.effectiveAt) === "" ? null : str(v.effectiveAt),
  ),
  recordTime: app("the node's recordTime, likewise", (v) =>
    str(v.recordTime) === "" ? null : str(v.recordTime),
  ),
  workflowId: app("the node's workflowId, likewise", (v) =>
    str(v.workflowId) === "" ? null : str(v.workflowId),
  ),
  synchronizerId: app("the node's synchronizerId, likewise", (v) =>
    str(v.synchronizerId) === "" ? null : str(v.synchronizerId),
  ),
  externalTransactionHash: app(
    "the hash that was signed, on its own row — never merged into the update id, because they are two different things",
    (v) => (str(v.externalTransactionHash) === "" ? null : str(v.externalTransactionHash)),
  ),
  submittedByYou: app(
    "true when the node sent a commandId that is not empty — a field it sends only to the party that submitted",
    (v) => str(v.commandId) !== null && v.commandId !== "",
  ),
};

// ── The two shapes of the answer ─────────────────────────────────────────────────

type Answer = {
  ctx: CheckContext;
  value: Record<string, unknown>;
  events: Event[];
  reasons: Reason[];
  mine: string[];
};

const TRANSACTION: Record<string, Rule<Answer>> = {
  kind: app("transaction", () => "transaction"),
  header: app("the transaction's own facts", (a) => buildObject(HEADER, a.value)),
  events: app("one row per event, in the node's order", (a) =>
    a.events.map((e) => buildObject(EVENT, e)),
  ),
  visibility: app(
    "no_own_parties when I hold no party at all, no_party_found when I hold parties and none of them appears, otherwise the parties that do and where",
    (a) =>
      a.mine.length === 0
        ? { status: "no_own_parties" }
        : a.reasons.length === 0
          ? { status: "no_party_found" }
          : { status: "ok", reasons: a.reasons.map((r) => buildObject(VISIBILITY_REASON, r)) },
  ),
  readAt: app("the instant the check handed the server as its clock", (a) => a.ctx.now.iso),
};

// **Only the transaction branch is exercised.** The tape holds no reassignment, topology change or
// checkpoint at a point lookup, so this branch is declared and never built (2026-09-18 codex). Seeding one
// means a reassignment between synchronizers, which the dev stack has only one of — recorded here as owed
// rather than pretended.
const NOT_A_TRANSACTION: Record<
  string,
  Rule<{ ctx: CheckContext; kind: string; value: Record<string, unknown> }>
> = {
  kind: app(
    "reassignment, topology or checkpoint — this version does not open these, and says so by name rather than skipping them into nothing",
    (o) => o.kind,
  ),
  updateId: app("the id of that thing, or null when it carries none", (o) =>
    str(o.value.updateId) === "" ? null : str(o.value.updateId),
  ),
  offset: app("its offset, or null", (o) => num(o.value.offset)),
  readAt: app("the instant the check handed the server as its clock", (o) => o.ctx.now.iso),
};

const UPDATE_DETAIL_RESPONSE: Branches = {
  by: "kind",
  of: [
    { when: ["transaction"], slots: TRANSACTION },
    { when: ["reassignment", "topology", "checkpoint"], slots: NOT_A_TRANSACTION },
  ],
};

export const updateDetailMapping: Mapping<CheckContext> = {
  root: "UpdateDetailResponse",
  slots: {
    UpdateDetailResponse: UPDATE_DETAIL_RESPONSE,
    UpdateDetailHeader: HEADER,
    UpdateDetailEventWithSchema: EVENT,
    UpdateVisibilityReason: VISIBILITY_REASON,
  },
  expected: (ctx): Expectation => {
    // Either address reaches one of these two node questions, and the answer must not depend on which.
    const lookup = ctx.trace.find(
      (call) =>
        call.method === "POST" &&
        (call.path === "/v2/updates/update-by-id" || call.path === "/v2/updates/update-by-offset"),
    );
    if (lookup === undefined) return { ok: false, why: "the trace holds no update point lookup" };
    const update = rec(rec(lookup.answer).update);
    for (const [key, kind] of [
      ["Reassignment", "reassignment"],
      ["TopologyTransaction", "topology"],
      ["OffsetCheckpoint", "checkpoint"],
    ] as const) {
      const wrapped = update[key];
      if (typeof wrapped === "object" && wrapped !== null && !Array.isArray(wrapped)) {
        return {
          ok: true,
          pages: [],
          body: buildObject(NOT_A_TRANSACTION, { ctx, kind, value: rec(rec(wrapped).value) }),
        };
      }
    }
    const transaction = update.Transaction;
    if (typeof transaction !== "object" || transaction === null) {
      return { ok: false, why: "the point lookup answered with a shape these rules do not read" };
    }
    const value = rec(rec(transaction).value);
    if (
      str(value.updateId) === null ||
      num(value.offset) === null ||
      !Array.isArray(value.events)
    ) {
      return { ok: false, why: "the transaction is not the shape these rules read" };
    }

    const events: Event[] = [];
    for (const rawEvent of arr(value.events)) {
      const created = rec(rawEvent).CreatedEvent;
      const exercised = rec(rawEvent).ExercisedEvent;
      const source = created ?? exercised;
      if (source === undefined) {
        return { ok: false, why: "an event is neither a CreatedEvent nor an ExercisedEvent" };
      }
      events.push({
        created: created === undefined ? null : rec(created),
        exercised: exercised === undefined ? null : rec(exercised),
        source: rec(source),
      });
    }

    // Gathered per party across the events, in the order my rights name them, and an event's position is
    // appended each time that party appears in it.
    const mine = myParties(ctx.trace);
    const byParty = new Map<string, Reason>();
    events.forEach((event, index) => {
      const signatories = event.created === null ? [] : stringsOf(event.created.signatories);
      const observers = event.created === null ? [] : stringsOf(event.created.observers);
      const witnesses = stringsOf(event.source.witnessParties);
      for (const party of mine) {
        const roles: string[] = [];
        if (signatories.includes(party)) roles.push("signatory");
        if (observers.includes(party)) roles.push("observer");
        // A stakeholder is not also a witness; a witness is what is left when neither applies.
        if (roles.length === 0 && witnesses.includes(party)) roles.push("witness");
        if (roles.length === 0) continue;
        const entry = byParty.get(party) ?? { party, roles: [], eventIndexes: [] };
        for (const role of roles) if (!entry.roles.includes(role)) entry.roles.push(role);
        entry.eventIndexes.push(index);
        byParty.set(party, entry);
      }
    });

    return {
      ok: true,
      pages: [],
      body: buildObject(TRANSACTION, { ctx, value, events, reasons: [...byParty.values()], mine }),
    };
  },
};
