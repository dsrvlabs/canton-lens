// **GET /api/preapprovals, written out again by hand.**
//
// A TransferPreapproval is the receiving side saying "you may send me this currency without asking first".
// This answer picks those contracts out of my own active contracts, says of each whether *I* am the receiver,
// and says how its expiry stands against an instant **the caller supplies** — this layer reads no clock, and
// the address requires `asOf` for exactly that reason.
//
// Written by reading router.ts, envelope.ts (`toLedgerAcsEntries`) and
// core/token-holdings/build-transfer-preapprovals.ts.
import {
  app,
  type Branches,
  buildObject,
  type CheckContext,
  type Expectation,
  type Mapping,
  node,
  type Rule,
} from "../mapping.ts";
import { arr, fqn, ledgerEnd, myParties, rec, str, wildcardAcsPages } from "./read-trace.ts";

/** The one template this screen knows, written as one constant the way the product writes it. */
const PREAPPROVAL = {
  packageName: "explorer-testdata",
  module: "Explorer",
  entity: "TransferPreapproval",
};

// ── Expiry ───────────────────────────────────────────────────────────────────────

type Expiry = { expiresAtMs: number; asOfMs: number };

const PASSED: Record<string, Rule<Expiry>> = {
  passed: app(
    "true — the expiry instant is at or before the instant the caller supplied",
    () => true,
  ),
  passedByMs: app(
    "how long ago it expired, and zero when the expiry instant cannot be read at all — an unreadable time is treated as past, never as time remaining",
    (e) => (Number.isNaN(e.expiresAtMs) ? 0 : e.asOfMs - e.expiresAtMs),
  ),
};

const NOT_PASSED: Record<string, Rule<Expiry>> = {
  passed: app("false — the expiry instant is after the instant the caller supplied", () => false),
  remainingMs: app("how long is left", (e) => e.expiresAtMs - e.asOfMs),
};

const EXPIRY: Branches = {
  by: "passed",
  of: [
    { when: ["true"], slots: PASSED },
    { when: ["false"], slots: NOT_PASSED },
  ],
};

const expiryOf = (e: Expiry): unknown =>
  Number.isNaN(e.expiresAtMs) || e.expiresAtMs <= e.asOfMs
    ? buildObject(PASSED, e)
    : buildObject(NOT_PASSED, e);

// ── One row ──────────────────────────────────────────────────────────────────────

type Row = {
  contractId: string;
  argument: Record<string, unknown>;
  mine: string[];
  asOfMs: number;
};

const receiverOf = (row: Row): string => str(row.argument.receiver) ?? "";

const PREAPPROVAL_ROW: Record<string, Rule<Row>> = {
  contractId: node("contractId"),
  receiver: app("the contract's receiver", receiverOf),
  receiverIsViewer: app(
    "whether that receiver is one of my own parties — the server settles it so the screen does not compare against my party list a second time",
    (row) => row.mine.includes(receiverOf(row)),
  ),
  issuer: app("the contract's issuer", (row) => str(row.argument.issuer)),
  instrumentId: app("the contract's currency, under the name the screen uses for it", (row) =>
    str(row.argument.currency),
  ),
  expiresAt: app("the contract's expiresAt, as the text the node sent", (row) =>
    str(row.argument.expiresAt),
  ),
  expiry: app("where that instant stands against the one the caller supplied", (row) =>
    expiryOf({ expiresAtMs: Date.parse(str(row.argument.expiresAt) ?? ""), asOfMs: row.asOfMs }),
  ),
};

const PROBLEM: Record<string, Rule<{ contractId: string; message: string }>> = {
  contractId: node("contractId"),
  message: app(
    "what was wrong with that one contract, in this application's own words — a contract whose payload cannot be read becomes a problem, not an invented row",
    (p) => p.message,
  ),
};

// **The order is stated, but the tape does not yet exercise all of it.** Dropping the valid-before-expired
// step from the product changes nothing in the recorded answers: no person holds both an expired and an
// unexpired preapproval with the same receiver. That is a gap in the seed, not in the rule — the sentence
// stays as written, and the data condition belongs on the list for the seed to grow.
const VIEW: Record<
  string,
  Rule<{ rows: Row[]; problems: { contractId: string; message: string }[] }>
> = {
  rows: app(
    "one row per preapproval, mine first, then the ones still valid, then by receiver and instrument — arrangement, not judgment",
    (v) => v.rows.map((row) => buildObject(PREAPPROVAL_ROW, row)),
  ),
  problems: app("one entry per contract that could not be read", (v) =>
    v.problems.map((problem) => buildObject(PROBLEM, problem)),
  ),
};

type Answer = {
  ctx: CheckContext;
  end: number;
  rows: Row[];
  problems: { contractId: string; message: string }[];
};

const AVAILABLE: Record<string, Rule<Answer>> = {
  kind: app("available — every entry the node sent was a shape this could read", () => "available"),
  view: app("the rows and the problems", (a) => buildObject(VIEW, a)),
  offset: app("the offset the contracts were read at", (a) => a.end),
  readAt: app("the instant the check handed the server as its clock", (a) => a.ctx.now.iso),
};

const UNAVAILABLE: Record<string, Rule<{ ctx: CheckContext; end: number; reason: string }>> = {
  kind: app(
    "unavailable — one entry was a shape this could not read, so no list is offered at all",
    () => "unavailable",
  ),
  reason: app("which shape, in this application's own words", (u) => u.reason),
  offset: app("the offset the contracts were read at", (u) => u.end),
  readAt: app("the instant the check handed the server as its clock", (u) => u.ctx.now.iso),
};

const PREAPPROVALS_RESPONSE: Branches = {
  by: "kind",
  of: [
    { when: ["available"], slots: AVAILABLE },
    { when: ["unavailable"], slots: UNAVAILABLE },
  ],
};

export const preapprovalsMapping: Mapping<CheckContext> = {
  root: "PreapprovalsResponse",
  slots: {
    PreapprovalsResponse: PREAPPROVALS_RESPONSE,
    TransferPreapprovalsView: VIEW,
    TransferPreapprovalRow: PREAPPROVAL_ROW,
    TransferPreapprovalExpiry: EXPIRY,
    TokenHoldingProblem: PROBLEM,
  },
  expected: (ctx): Expectation => {
    const end = ledgerEnd(ctx.trace);
    if (end === null) return { ok: false, why: "the trace holds no ledger end" };
    const asOf = new URL(ctx.url, "http://check").searchParams.get("asOf");
    const asOfMs = Date.parse(asOf ?? "");
    if (Number.isNaN(asOfMs)) {
      return {
        ok: true,
        pages: [],
        body: buildObject(UNAVAILABLE, { ctx, end, reason: "invalid_as_of" }),
      };
    }
    const pages = wildcardAcsPages(ctx.trace);
    if (pages.length === 0) {
      return { ok: false, why: "the trace holds no unnarrowed active-contracts call" };
    }
    const mine = myParties(ctx.trace);
    const rows: Row[] = [];
    const problems: { contractId: string; message: string }[] = [];
    for (const page of pages) {
      for (const item of arr(page.answer)) {
        const event = rec(rec(rec(rec(item).contractEntry).JsActiveContract).createdEvent);
        const contractId = str(event.contractId);
        const packageName = str(event.packageName);
        const parts = fqn(event.templateId);
        if (contractId === null || packageName === null || parts === null) {
          return { ok: false, why: "an active-contracts entry is not the shape these rules read" };
        }
        // **Every contract passes through, and only this template stays.** The screen knows one template and
        // says so in one place; anything else is simply not this screen's business.
        if (
          packageName !== PREAPPROVAL.packageName ||
          parts[1] !== PREAPPROVAL.module ||
          parts[2] !== PREAPPROVAL.entity
        ) {
          continue;
        }
        const argument = event.createArgument;
        if (typeof argument !== "object" || argument === null || Array.isArray(argument)) {
          problems.push({ contractId, message: "create_argument_not_record" });
          continue;
        }
        const payload = rec(argument);
        if (
          str(payload.receiver) === null ||
          str(payload.issuer) === null ||
          str(payload.currency) === null ||
          str(payload.expiresAt) === null
        ) {
          problems.push({ contractId, message: "payload_shape_mismatch" });
          continue;
        }
        rows.push({ contractId, argument: payload, mine, asOfMs });
      }
    }
    // Mine on top, valid above expired, then receiver, then instrument.
    const passed = (row: Row): boolean => {
      const at = Date.parse(str(row.argument.expiresAt) ?? "");
      return Number.isNaN(at) || at <= asOfMs;
    };
    rows.sort((a, b) => {
      const aMine = mine.includes(receiverOf(a));
      const bMine = mine.includes(receiverOf(b));
      if (aMine !== bMine) return aMine ? -1 : 1;
      if (passed(a) !== passed(b)) return passed(a) ? 1 : -1;
      if (receiverOf(a) !== receiverOf(b)) return receiverOf(a) < receiverOf(b) ? -1 : 1;
      const ai = str(a.argument.currency) ?? "";
      const bi = str(b.argument.currency) ?? "";
      return ai < bi ? -1 : ai > bi ? 1 : 0;
    });
    return { ok: true, pages: [], body: buildObject(AVAILABLE, { ctx, end, rows, problems }) };
  },
};
