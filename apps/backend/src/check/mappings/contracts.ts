// **GET /api/contracts, written out again by hand.**
//
// Every slot of every schema this answer can reach is a line below. The rules were written by reading
// router.ts and core/contract-list/build-contract-list.ts and stating, again, what they do — not by calling
// them. Calling `buildContractList` here would build the expected answer with the same bug the real one has
// and the check would pass through it.
//
// The node side of this path is four questions: the ledger end (which offset to read at), the authenticated
// user and their rights (which parties are mine), and the active contracts themselves, which arrive in pages.
import {
  ABSENT,
  app,
  buildObject,
  type CheckContext,
  type Expectation,
  type Mapping,
  nFrom,
  node,
  type Rule,
} from "../mapping.ts";
import { answerOf, arr, fqn, myParties, rec, str, wildcardAcsPages } from "./read-trace.ts";

// ── The node object a row is made from ───────────────────────────────────────────
// One active contract's created event. The list is sorted and cut *before* the rules run, so a rule only ever
// sees the event it describes.
type Event = Record<string, unknown>;

const parties = (event: Event, key: "signatories" | "observers"): string[] =>
  arr(event[key]).filter((p): p is string => typeof p === "string");

// Newest first: offset descending, then createdAt descending, then contractId ascending. The last is not a
// preference — with two contracts created at one offset and instant, without it the order is whatever the node
// happened to send, and the page boundary would move on its own.
const newestFirst = (a: Event, b: Event): number => {
  const ao = typeof a.offset === "number" ? a.offset : -1;
  const bo = typeof b.offset === "number" ? b.offset : -1;
  if (ao !== bo) return bo - ao;
  const ac = str(a.createdAt) ?? "";
  const bc = str(b.createdAt) ?? "";
  if (ac !== bc) return ac < bc ? 1 : -1;
  const ai = str(a.contractId) ?? "";
  const bi = str(b.contractId) ?? "";
  return ai === bi ? 0 : ai < bi ? -1 : 1;
};

// ── The slot tables ──────────────────────────────────────────────────────────────

/** One of my parties and the event it was found in — the material for one "why I can see this" line. */
type Role = { party: string; event: Event };

const VISIBILITY_REASON: Record<string, Rule<Role>> = {
  party: app("one of my parties, in the order my rights list them", (r) => r.party),
  roles: app(
    "signatory when that party is among the node's signatories, observer when among its observers, in that order (the ACS carries no witnesses)",
    (r) => [
      ...(parties(r.event, "signatories").includes(r.party) ? ["signatory"] : []),
      ...(parties(r.event, "observers").includes(r.party) ? ["observer"] : []),
    ],
  ),
};

const CONTRACT_LIST_ROW: Record<string, Rule<{ event: Event; mine: string[] }>> = {
  contractId: node("event.contractId"),
  package: app(
    "the first of the three colon-separated parts of the node's templateId",
    ({ event }) => fqn(event.templateId)?.[0],
  ),
  packageName: app("the node's packageName, or null when the node sent none", ({ event }) =>
    str(event.packageName),
  ),
  module: app(
    "the second of the three parts of the node's templateId",
    ({ event }) => fqn(event.templateId)?.[1],
  ),
  entity: app(
    "the third of the three parts of the node's templateId",
    ({ event }) => fqn(event.templateId)?.[2],
  ),
  counterpartyParty: app(
    "the node's signatories then its observers, each kept at its first appearance, with my own parties removed",
    ({ event, mine }) =>
      [...new Set([...parties(event, "signatories"), ...parties(event, "observers")])].filter(
        (p) => !mine.includes(p),
      ),
  ),
  myRoles: app(
    "one line per party of mine that appears in this contract, in the order my rights list them",
    ({ event, mine }) =>
      mine
        .filter(
          (party) =>
            parties(event, "signatories").includes(party) ||
            parties(event, "observers").includes(party),
        )
        .map((party) => buildObject(VISIBILITY_REASON, { party, event })),
  ),
  createdAt: node("event.createdAt"),
  offset: app("the node's creation offset, or null when the node sent none", ({ event }) =>
    typeof event.offset === "number" ? event.offset : null,
  ),
};

const CONTRACT_LIST_CURSOR: Record<string, Rule<Event>> = {
  offset: app("the last shown row's offset", (e) =>
    typeof e.offset === "number" ? e.offset : null,
  ),
  createdAt: node("createdAt"),
  contractId: node("contractId"),
};

const CONTRACT_LIST_FILTER: Record<string, Rule<CheckContext>> = {
  template: app(
    "the query's template, absent when it was not asked for",
    (ctx) => new URL(ctx.url, "http://check").searchParams.get("template") ?? ABSENT,
  ),
  parties: app(
    "the query's party values, duplicates removed, absent when none were asked for",
    (ctx) => {
      const asked = new URL(ctx.url, "http://check").searchParams.getAll("party");
      const unique = [
        ...new Set(asked.flatMap((value) => value.split(",")).filter((v) => v !== "")),
      ];
      return unique.length === 0 ? ABSENT : unique;
    },
  ),
};

// The page size the response was cut to. The product's default is 100 (build-contract-list.ts).
const DEFAULT_PAGE_SIZE = 100;
const pageSizeOf = (url: string): number => {
  const asked = new URL(url, "http://check").searchParams.get("pageSize");
  return asked !== null && /^[1-9][0-9]*$/.test(asked)
    ? Number.parseInt(asked, 10)
    : DEFAULT_PAGE_SIZE;
};

/**
 * **Where a page begins.** The address may carry the cursor a previous page handed back — three values that
 * name one row — and the page then starts at the first row that sorts *strictly after* it.
 *
 * Written out here because it is the one rule a single page cannot show: a cursor that stops one row early
 * repeats a row, a cursor that stops one row late loses one, and the first page's answer is identical in
 * both cases. A cursor read and never sent is a value nothing checks (2026-09-18).
 */
const cursorOf = (url: string): Event | null => {
  const query = new URL(url, "http://check").searchParams;
  const createdAt = query.get("cursorCreatedAt");
  const contractId = query.get("cursorContractId");
  if (createdAt === null || contractId === null) return null;
  const offset = query.get("cursorOffset");
  return {
    createdAt,
    contractId,
    // A row with no offset sorts to the back and its cursor says so by leaving the key out — the same rule
    // `newestFirst` states with -1.
    ...(offset !== null && /^[0-9]+$/.test(offset) ? { offset: Number.parseInt(offset, 10) } : {}),
  };
};

// ── The whole answer ─────────────────────────────────────────────────────────────

// What the top-level rules are handed: the trace already read, sorted and cut. Doing that here rather than
// inside the rules is what lets each slot below be one sentence.
type Answer = {
  ctx: CheckContext;
  /** The offset the ledger end reported. */
  end: number;
  /** Every active contract the node returned, newest first. */
  ordered: Event[];
  /** The tail of it that starts after the cursor the address carried — all of it when it carried none. */
  remaining: Event[];
  /** The part of *that* which fits on this page. */
  shown: Event[];
  mine: string[];
};

const CONTRACTS_RESPONSE: Record<string, Rule<Answer>> = {
  offset: app("the offset the ledger end reported", (a) => a.end),
  readAt: app("the instant the check handed the server as its clock", (a) => a.ctx.now.iso),
  rows: app(
    "one row per active contract the node returned, newest first, cut to the page size",
    (a) => a.shown.map((event) => buildObject(CONTRACT_LIST_ROW, { event, mine: a.mine })),
  ),
  nextCursor: app(
    "the last shown row when more was left after this page than fitted on it, otherwise null",
    (a) => {
      const last = a.shown[a.shown.length - 1];
      const more = a.shown.length < a.remaining.length;
      return more && last !== undefined ? buildObject(CONTRACT_LIST_CURSOR, last) : null;
    },
  ),
  total: app(
    "how many active contracts the node returned, before any filter",
    (a) => a.ordered.length,
  ),
  matched: app("how many of them pass the query's filter", (a) => a.ordered.length),
  filter: app("the filter the query asked for", (a) => buildObject(CONTRACT_LIST_FILTER, a.ctx)),
};

export const contractsMapping: Mapping<CheckContext> = {
  root: "ContractsResponse",
  slots: {
    ContractsResponse: CONTRACTS_RESPONSE,
    ContractListRow: CONTRACT_LIST_ROW,
    ContractListCursor: CONTRACT_LIST_CURSOR,
    ContractListFilter: CONTRACT_LIST_FILTER,
    VisibilityReason: VISIBILITY_REASON,
  },
  expected: (ctx): Expectation => {
    const end = rec(answerOf(ctx.trace, "GET", "/v2/state/ledger-end")).offset;
    if (typeof end !== "number") {
      return {
        ok: false,
        why: "the trace holds no ledger end, so the offset to read at is unknown",
      };
    }
    const acsPages = wildcardAcsPages(ctx.trace);
    if (acsPages.length === 0) {
      return { ok: false, why: "the trace holds no wildcard active-contracts call" };
    }
    const events: Event[] = [];
    for (const acsPage of acsPages) {
      for (const item of arr(acsPage.answer)) {
        const entry = rec(rec(item).contractEntry);
        if (entry.JsActiveContract === undefined) {
          // Any other entry kind (an incomplete assignment, say) is a shape these rules were not written for.
          // Guessing would put a number in the expected answer that nobody derived.
          const kinds = Object.keys(entry).join(",") || "(empty)";
          return {
            ok: false,
            why: `an active-contracts entry is not a JsActiveContract: ${kinds}`,
          };
        }
        events.push(rec(rec(entry.JsActiveContract).createdEvent));
      }
    }
    // **These rules describe the unfiltered question only.** The two addresses phase 1 asks carry no filter.
    // Saying so is the point: a filtered question answered by these rules would compare against a count
    // nobody derived, and that is the shape of a check that is green while looking at nothing.
    const filter = buildObject(CONTRACT_LIST_FILTER, ctx) as Record<string, unknown>;
    if (Object.keys(filter).length > 0) {
      return { ok: false, why: "these rules do not describe a filtered question yet" };
    }
    const ordered = [...events].sort(newestFirst);
    // **`total` and `matched` count the whole list, not what is left after the cursor.** The cursor moves
    // where the page starts; it does not make the earlier rows stop existing, and a count that shrank with
    // the cursor would tell the screen the list got smaller as it was read.
    const after = cursorOf(ctx.url);
    const remaining =
      after === null ? ordered : ordered.filter((event) => newestFirst(event, after) > 0);
    const page = nFrom(remaining, pageSizeOf(ctx.url), {
      of: ordered.length,
      totalAt: "matched",
    });
    const answer: Answer = {
      ctx,
      end,
      ordered,
      remaining,
      shown: page.shown,
      mine: myParties(ctx.trace),
    };
    return { ok: true, pages: [page], body: buildObject(CONTRACTS_RESPONSE, answer) };
  },
};
