// **GET /api/offers, written out again by hand.**
//
// A transfer instruction is an offer sitting on the ledger waiting to be accepted. This answer reads the
// standard TransferInstruction view the node attaches, and settles two things the screen must not settle
// again: **which way the transfer runs relative to me**, and **whether its deadline has passed** — against an
// instant the caller supplies, because this layer reads no clock.
//
// **Direction is a single chokepoint.** received · sent · internal · third_party, decided in one place from
// my own parties; and `unknown` with a reason when there are no parties to decide against, which is not the
// same thing as third_party and must never be shown as one.
//
// Written by reading router.ts and core/transfer-offers/build-transfer-offers.ts.
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
import { acsPagesForInterface, arr, myParties, num, rec, str } from "./read-trace.ts";

// ── Expiry ───────────────────────────────────────────────────────────────────────

type Expiry = { atMs: number; asOfMs: number };

const PASSED: Record<string, Rule<Expiry>> = {
  passed: app("true — the deadline is at or before the instant the caller supplied", () => true),
  passedByMs: app(
    "how long ago it passed, and zero when the deadline cannot be read at all — an unreadable deadline is treated as past, never as time remaining",
    (e) => (Number.isNaN(e.atMs) ? 0 : e.asOfMs - e.atMs),
  ),
};
const NOT_PASSED: Record<string, Rule<Expiry>> = {
  passed: app("false — the deadline is after the instant the caller supplied", () => false),
  remainingMs: app("how long is left", (e) => e.atMs - e.asOfMs),
};
const EXPIRY: Branches = {
  by: "passed",
  of: [
    { when: ["true"], slots: PASSED },
    { when: ["false"], slots: NOT_PASSED },
  ],
};

// ── Direction ────────────────────────────────────────────────────────────────────

const DIRECTION_UNKNOWN: Record<string, Rule<{ reason: string }>> = {
  direction: app(
    "unknown — there were no parties of mine to decide against. It is not third_party: not knowing which way it runs is a different statement from knowing it runs between two others",
    () => "unknown",
  ),
  reason: app(
    "which of the two ways there were none, in this application's own words",
    (d) => d.reason,
  ),
};
const DIRECTION_KNOWN: Record<string, Rule<{ direction: string }>> = {
  direction: app(
    "internal when both ends are mine, received when only the receiver is, sent when only the sender is, third_party when neither",
    (d) => d.direction,
  ),
};
const DIRECTION: Branches = {
  by: "direction",
  of: [
    { when: ["unknown"], slots: DIRECTION_UNKNOWN },
    { when: ["received", "sent", "internal", "third_party"], slots: DIRECTION_KNOWN },
  ],
};

// ── One row ──────────────────────────────────────────────────────────────────────

type Row = {
  contractId: string;
  interfaceId: string;
  transfer: Record<string, unknown>;
  mine: string[];
  asOfMs: number;
};

const senderOf = (row: Row): string => str(row.transfer.sender) ?? "";
const receiverOf = (row: Row): string => str(row.transfer.receiver) ?? "";

const directionOf = (row: Row): unknown => {
  if (row.mine.length === 0) {
    return buildObject(DIRECTION_UNKNOWN, { reason: "viewer_parties_empty" });
  }
  const isSender = row.mine.includes(senderOf(row));
  const isReceiver = row.mine.includes(receiverOf(row));
  const direction =
    isSender && isReceiver
      ? "internal"
      : isReceiver
        ? "received"
        : isSender
          ? "sent"
          : "third_party";
  return buildObject(DIRECTION_KNOWN, { direction });
};

const OFFER_ROW: Record<string, Rule<Row>> = {
  contractId: node("contractId"),
  interfaceId: app(
    "the interface the caller asked through, echoed as asked",
    (row) => row.interfaceId,
  ),
  sender: app("the view's sender", senderOf),
  receiver: app("the view's receiver", receiverOf),
  amount: app("the view's amount, as the text the node sent", (row) => str(row.transfer.amount)),
  instrumentId: app(
    "the id inside the standard instrument record, or the view's value as it came when it is not one",
    (row) => {
      const raw = row.transfer.instrumentId;
      const id = str(rec(raw).id);
      return id === null ? raw : id;
    },
  ),
  executeBefore: app("the view's executeBefore, as the text the node sent", (row) =>
    str(row.transfer.executeBefore),
  ),
  expiry: app("where that deadline stands against the instant the caller supplied", (row) =>
    expiryOf({ atMs: Date.parse(str(row.transfer.executeBefore) ?? ""), asOfMs: row.asOfMs }),
  ),
  directionInfo: app(
    "which way this runs relative to me — settled here, never again on the screen",
    directionOf,
  ),
};

const expiryOf = (e: Expiry): unknown =>
  Number.isNaN(e.atMs) || e.atMs <= e.asOfMs ? buildObject(PASSED, e) : buildObject(NOT_PASSED, e);

type Problem = {
  contractId: string;
  interfaceId: string;
  code: number;
  message: string;
  details: unknown[];
};

const OFFER_PROBLEM: Record<string, Rule<Problem>> = {
  contractId: node("contractId"),
  interfaceId: node("interfaceId"),
  code: app("the node's view status code, or -1 when it sent none that is a number", (p) => p.code),
  message: app(
    "the node's view status message, the empty string when it sent none, or this application's own words when the status was success but the fields were not there",
    (p) => p.message,
  ),
  details: app("the node's view status details, or an empty list", (p) => p.details),
};

const VIEW: Record<string, Rule<{ rows: Row[]; problems: Problem[] }>> = {
  rows: app(
    "one row per contract carrying a readable view of that interface, in the order the node sent them",
    (v) => v.rows.map((row) => buildObject(OFFER_ROW, row)),
  ),
  problems: app("one entry per contract whose view of that interface could not be read", (v) =>
    v.problems.map((problem) => buildObject(OFFER_PROBLEM, problem)),
  ),
};

type Answer = { ctx: CheckContext; rows: Row[]; problems: Problem[] };

const AVAILABLE: Record<string, Rule<Answer>> = {
  kind: app(
    "available — the node's answer was a list, and the instant asked about could be read",
    () => "available",
  ),
  view: app("the rows and the problems", (a) => buildObject(VIEW, a)),
  readAt: app("the instant the check handed the server as its clock", (a) => a.ctx.now.iso),
};
const UNAVAILABLE: Record<string, Rule<{ ctx: CheckContext; reason: string }>> = {
  kind: app(
    "unavailable — carried inside a 200, because the node is fine and the question was not",
    () => "unavailable",
  ),
  reason: app("which of the two, in this application's own words", (u) => u.reason),
  readAt: app("the instant the check handed the server as its clock", (u) => u.ctx.now.iso),
};
const OFFERS_RESPONSE: Branches = {
  by: "kind",
  of: [
    { when: ["available"], slots: AVAILABLE },
    { when: ["unavailable"], slots: UNAVAILABLE },
  ],
};

/** Two ids name one interface when module and entity agree and either side is written as a name. */
const sameInterface = (a: string, b: string): boolean => {
  const x = a.split(":");
  const y = b.split(":");
  if (x.length !== 3 || y.length !== 3) return false;
  if (x[1] !== y[1] || x[2] !== y[2]) return false;
  return x[0]?.startsWith("#") || y[0]?.startsWith("#") ? true : x[0] === y[0];
};

export const offersMapping: Mapping<CheckContext> = {
  root: "OffersResponse",
  slots: {
    OffersResponse: OFFERS_RESPONSE,
    TransferOffersView: VIEW,
    TransferOfferRow: OFFER_ROW,
    TransferOfferProblem: OFFER_PROBLEM,
    TransferOfferExpiry: EXPIRY,
    TransferDirectionInfo: DIRECTION,
  },
  expected: (ctx): Expectation => {
    const query = new URL(ctx.url, "http://check").searchParams;
    const interfaceId = query.get("interfaceId");
    if (interfaceId === null) return { ok: false, why: "the address names no interface" };
    const asOfMs = Date.parse(query.get("asOf") ?? "");
    if (Number.isNaN(asOfMs)) {
      return {
        ok: true,
        pages: [],
        body: buildObject(UNAVAILABLE, { ctx, reason: "invalid_as_of" }),
      };
    }
    const pages = acsPagesForInterface(ctx.trace, interfaceId);
    if (pages.length === 0) {
      return { ok: false, why: `the trace holds no active-contracts call through ${interfaceId}` };
    }
    const mine = myParties(ctx.trace);
    const rows: Row[] = [];
    const problems: Problem[] = [];
    for (const page of pages) {
      for (const item of arr(page.answer)) {
        const event = rec(rec(rec(rec(item).contractEntry).JsActiveContract).createdEvent);
        const contractId = str(event.contractId);
        if (contractId === null) continue;
        const view = arr(event.interfaceViews).find((v) => {
          const id = str(rec(v).interfaceId);
          return id !== null && sameInterface(id, interfaceId);
        });
        // **A contract with no view of this interface is not an offer** — not a failure, not a row.
        if (view === undefined) continue;
        const status = rec(rec(view).viewStatus);
        const code = num(status.code);
        if (code !== 0) {
          problems.push({
            contractId,
            interfaceId,
            code: code ?? -1,
            message: str(status.message) ?? "",
            details: arr(status.details),
          });
          continue;
        }
        // The standard puts the five fields inside a `transfer` record; an older mock standard put them flat.
        // Both shapes have existed on a real node, so both are read, and the nested one wins where it is there.
        const value = rec(rec(view).viewValue);
        const transfer =
          typeof value.transfer === "object" &&
          value.transfer !== null &&
          !Array.isArray(value.transfer)
            ? rec(value.transfer)
            : value;
        if (
          str(transfer.sender) === null ||
          str(transfer.receiver) === null ||
          str(transfer.amount) === null ||
          str(transfer.executeBefore) === null
        ) {
          // The node called the view a success and then did not send the fields. That is not a row to invent.
          problems.push({
            contractId,
            interfaceId,
            code: 0,
            message: "view_value_shape_mismatch",
            details: [],
          });
          continue;
        }
        rows.push({ contractId, interfaceId, transfer, mine, asOfMs });
      }
    }
    return { ok: true, pages: [], body: buildObject(AVAILABLE, { ctx, rows, problems }) };
  },
};
