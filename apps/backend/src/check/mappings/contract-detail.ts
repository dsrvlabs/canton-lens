// **GET /api/contracts/{contractId}, written out again by hand.**
//
// One contract, opened — and it is opened **out of my own active contracts**, not by asking the node for
// that id. That is the reason for the one place in this application where four different situations give one
// answer: a contract that never existed, one that was archived, one that exists and is not mine to see, and
// one whose id I mistyped all leave the same trace here, because the active-contracts response carries no
// material to tell them apart. It answers 404 and says nothing more, which is the honest thing and also the
// Canton-shaped thing: what is invisible is not even known to exist.
//
// **The decoded schema block is declined as a whole**, for the reason the package catalogue gives: a
// template's fields, choices and typed payload are what the package bytes decode to, and restating that rule
// means writing a second Daml-LF decoder. One abstention covers the shape beneath it.
//
// **Three slots say "not in this version" rather than going missing.** choices, history and relatedContracts
// have no material at this layer at all, and a screen that simply lacked them could not tell "we do not do
// this" from "there are none".
//
// Written by reading router.ts, envelope.ts (`toLedgerAcsEntries`),
// core/contract-detail/build-contract-detail.ts and core/visibility/explain-visibility.ts.
import {
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
import { arr, fqn, myParties, num, rec, str, stringsOf, wildcardAcsPages } from "./read-trace.ts";

// ── The three slots with no material ─────────────────────────────────────────────

const NOT_IN_THIS_VERSION: Record<string, Rule<unknown>> = {
  kind: app(
    "not_in_this_version — there is no material for it at this layer, and saying so is different from leaving the slot out and letting a screen read absence as emptiness",
    () => "not_in_this_version",
  ),
};
const FETCH_FAILED: Record<string, Rule<{ reason: string }>> = {
  kind: app("fetch_failed — a lookup was made for it and did not come back", () => "fetch_failed"),
  reason: app("why, by name", (f) => f.reason),
};
const UNAVAILABLE: Branches = {
  by: "kind",
  of: [
    { when: ["not_in_this_version"], slots: NOT_IN_THIS_VERSION },
    { when: ["fetch_failed"], slots: FETCH_FAILED },
  ],
};
const notInThisVersion = (): unknown => buildObject(NOT_IN_THIS_VERSION, undefined);

// ── The contract key ─────────────────────────────────────────────────────────────

const KEY_NONE: Record<string, Rule<unknown>> = {
  kind: app("none — the node sent no key, or sent null. Daml 3 has no contract keys", () => "none"),
};
const KEY_PRESENT: Record<string, Rule<{ value: unknown }>> = {
  kind: app("present", () => "present"),
  value: app("the key the node sent, copied untouched", (k) => k.value),
};
const CONTRACT_KEY: Branches = {
  by: "kind",
  of: [
    { when: ["none"], slots: KEY_NONE },
    { when: ["present"], slots: KEY_PRESENT },
  ],
};

// ── Why I can see it ─────────────────────────────────────────────────────────────

const VISIBILITY_REASON: Record<string, Rule<{ party: string; roles: string[] }>> = {
  party: app("one of my parties, in the order my rights list them", (r) => r.party),
  roles: app(
    "signatory and observer, in that order, where that party is among them. **Two capacities here, not three**: this reading carries stakeholders only, and witness exists at the event level of an update",
    (r) => r.roles,
  ),
};

const VISIBILITY_OK: Record<string, Rule<{ reasons: { party: string; roles: string[] }[] }>> = {
  status: app("ok", () => "ok"),
  reasons: app("the parties of mine that appear, and how", (v) =>
    v.reasons.map((r) => buildObject(VISIBILITY_REASON, r)),
  ),
};
const VISIBILITY_NO_PARTY_FOUND: Record<string, Rule<unknown>> = {
  status: app(
    "no_party_found — I hold parties, we looked, and none of them appears. The material is lacking; it does not say the contract is invisible, because this contract did reach me",
    () => "no_party_found",
  ),
};
const VISIBILITY_NO_OWN_PARTIES: Record<string, Rule<unknown>> = {
  status: app(
    "no_own_parties — I hold no party at all, so there is no list to intersect and the question does not apply. A super reader reads as every party and is party to none",
    () => "no_own_parties",
  ),
};
const VISIBILITY_UNAVAILABLE: Record<string, Rule<{ reason: string }>> = {
  status: app("unavailable — the stakeholder lists were not lists of strings", () => "unavailable"),
  reason: app("which of them, in this application's own words", (v) => v.reason),
};
const VISIBILITY: Branches = {
  by: "status",
  of: [
    { when: ["ok"], slots: VISIBILITY_OK },
    { when: ["no_party_found"], slots: VISIBILITY_NO_PARTY_FOUND },
    { when: ["no_own_parties"], slots: VISIBILITY_NO_OWN_PARTIES },
    { when: ["unavailable"], slots: VISIBILITY_UNAVAILABLE },
  ],
};

// ── The whole answer ─────────────────────────────────────────────────────────────

type Answer = {
  ctx: CheckContext;
  /** The createdEvent of the one active contract that carries this id. */
  event: Record<string, unknown>;
  /** The JsActiveContract around it — two of the structure slots come from there, not from the event. */
  active: Record<string, unknown>;
  mine: string[];
};

const signatoriesOf = (a: Answer): string[] => stringsOf(a.event.signatories);
const observersOf = (a: Answer): string[] => stringsOf(a.event.observers);

const CONTRACT_DETAIL_RESPONSE: Record<string, Rule<Answer>> = {
  templateId: node("event.templateId"),
  packageId: app(
    "the first of the three colon-separated parts of the templateId",
    (a) => fqn(a.event.templateId)?.[0],
  ),
  packageName: node("event.packageName"),
  module: app("the second of the three parts", (a) => fqn(a.event.templateId)?.[1]),
  entity: app("the third of the three parts", (a) => fqn(a.event.templateId)?.[2]),
  createArgument: app(
    "the node's createArgument, copied untouched — the screen renders the raw JSON",
    (a) => a.event.createArgument,
  ),
  signatories: app("the node's signatories", signatoriesOf),
  observers: app("the node's observers", observersOf),
  createdAt: node("event.createdAt"),
  // **Unreachable through this address, and not for want of data** (2026-09-18): this path reads the active
  // contracts with a wildcard filter (router.ts), which asks for no interface view at all, so no answer it can
  // give carries one and `interface` cannot come out of it whatever the ledger holds. Seeding a contract that
  // implements one — and the seed now has several — changes nothing here. The rule stays as written because
  // the shape it describes is real; what would reach it is a different question than this address asks
  // (check/conditions.ts records it as out of reach rather than owed).
  renderMode: app(
    "interface when the node attached any interface view to this contract, generic when it attached none",
    (a) => (arr(a.event.interfaceViews).length > 0 ? "interface" : "generic"),
  ),
  interfaceViews: app("the node's interface views, copied untouched", (a) =>
    arr(a.event.interfaceViews),
  ),
  choices: app(
    "not in this version — a contract's choices are not in this reading",
    notInThisVersion,
  ),
  history: app(
    "not in this version — this reading is of the present state, and holds no past",
    notInThisVersion,
  ),
  relatedContracts: app("not in this version", notInThisVersion),
  synchronizerId: app(
    "the synchronizer from the active-contract wrapper, not from the event — or null when the node sent none",
    (a) => str(a.active.synchronizerId),
  ),
  reassignmentCounter: app("likewise from the wrapper, or null", (a) =>
    num(a.active.reassignmentCounter),
  ),
  createdAtOffset: app(
    "the offset the contract was created at, or null — the material for the link to the creating update, since this reading carries no update id",
    (a) => num(a.event.offset),
  ),
  contractKey: app("the node's contractKey, or none when it sent none or sent null", (a) =>
    a.event.contractKey === null || a.event.contractKey === undefined
      ? buildObject(KEY_NONE, undefined)
      : buildObject(KEY_PRESENT, { value: a.event.contractKey }),
  ),
  visibility: app("why I can see this", (a) => {
    if (a.mine.length === 0) return buildObject(VISIBILITY_NO_OWN_PARTIES, undefined);
    const reasons = a.mine
      .map((party) => ({
        party,
        roles: [
          ...(signatoriesOf(a).includes(party) ? ["signatory"] : []),
          ...(observersOf(a).includes(party) ? ["observer"] : []),
        ],
      }))
      .filter((r) => r.roles.length > 0);
    return reasons.length === 0
      ? buildObject(VISIBILITY_NO_PARTY_FOUND, undefined)
      : buildObject(VISIBILITY_OK, { reasons });
  }),
  schema: unjudged(
    "a template's definition and the payload typed against it are what the package bytes decode to",
  ),
  readAt: app("the instant the check handed the server as its clock", (a) => a.ctx.now.iso),
};

export const contractDetailMapping: Mapping<CheckContext> = {
  root: "ContractDetailResponse",
  slots: {
    ContractDetailResponse: CONTRACT_DETAIL_RESPONSE,
    ContractDetailUnavailable: UNAVAILABLE,
    ContractKeyView: CONTRACT_KEY,
    VisibilityExplanation: VISIBILITY,
    VisibilityReason: VISIBILITY_REASON,
  },
  expected: (ctx): Expectation => {
    const asked = ctx.url.split("?")[0]?.split("/").pop() ?? "";
    const contractId = decodeURIComponent(asked);
    const pages = wildcardAcsPages(ctx.trace);
    if (pages.length === 0) {
      return { ok: false, why: "the trace holds no unnarrowed active-contracts call" };
    }
    for (const page of pages) {
      for (const item of arr(page.answer)) {
        const active = rec(rec(rec(item).contractEntry).JsActiveContract);
        const event = rec(active.createdEvent);
        if (str(event.contractId) !== contractId) continue;
        if (fqn(event.templateId) === null) {
          return { ok: false, why: `unparseable template id on ${contractId}` };
        }
        return {
          ok: true,
          pages: [],
          body: buildObject(CONTRACT_DETAIL_RESPONSE, {
            ctx,
            event,
            active,
            mine: myParties(ctx.trace),
          }),
        };
      }
    }
    // **Not among my active contracts.** The answer is a 404 and these rules describe a 200, so there is no
    // expected body — and that is the right place for this to stop: which of the four situations it was is
    // exactly what this layer cannot know.
    return {
      ok: false,
      why: `${contractId} is not among the active contracts this question returned`,
    };
  },
};
