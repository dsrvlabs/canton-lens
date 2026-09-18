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
  firstN,
  type Mapping,
  node,
  type Rule,
} from "../mapping.ts";
import { contractsAskedEverything } from "../own-set.ts";
import type { NodeCall } from "../trace.ts";

const rec = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

// ── Reading the trace ────────────────────────────────────────────────────────────

const answerOf = (trace: readonly NodeCall[], method: string, path: string): unknown =>
  trace.find((call) => call.method === method && call.path === path)?.answer;

// **Only the pages asked with a wildcard filter.** This one API call also reaches the node for the ledger end
// and the user's rights, and other API calls ask the same active-contracts path with an *interface* filter.
// Picking by "it is an active-contracts call" would fold a narrower question's answer into this one's.
// The judgment is the answer key's (own-set.ts) — "was this asked without narrowing" is one question and it
// has one definition.
const wildcardAcsPages = (trace: readonly NodeCall[]): NodeCall[] =>
  trace.filter(
    (call) =>
      call.method === "POST" &&
      call.path.startsWith("/v2/state/active-contracts") &&
      contractsAskedEverything(call.body),
  );

/** The parties that are mine, in the order the rights response lists them first. */
const myParties = (trace: readonly NodeCall[]): string[] => {
  const rights = trace.find((call) => call.path.endsWith("/rights"))?.answer;
  const order: string[] = [];
  for (const item of arr(rec(rights).rights)) {
    const kind = rec(rec(item).kind);
    for (const name of ["CanReadAs", "CanActAs"] as const) {
      const party = str(rec(rec(kind[name]).value).party);
      if (party !== null && !order.includes(party)) order.push(party);
    }
  }
  return order;
};

// ── The node object a row is made from ───────────────────────────────────────────
// One active contract's created event. The list is sorted and cut *before* the rules run, so a rule only ever
// sees the event it describes.
type Event = Record<string, unknown>;

const parties = (event: Event, key: "signatories" | "observers"): string[] =>
  arr(event[key]).filter((p): p is string => typeof p === "string");

/** The three pieces of the template identifier: `<packageId>:<Module>:<Entity>`. */
const fqn = (event: Event): [string, string, string] | null => {
  const parts = (str(event.templateId) ?? "").split(":");
  return parts.length === 3 ? [parts[0] ?? "", parts[1] ?? "", parts[2] ?? ""] : null;
};

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
    ({ event }) => fqn(event)?.[0],
  ),
  packageName: app("the node's packageName, or null when the node sent none", ({ event }) =>
    str(event.packageName),
  ),
  module: app(
    "the second of the three parts of the node's templateId",
    ({ event }) => fqn(event)?.[1],
  ),
  entity: app(
    "the third of the three parts of the node's templateId",
    ({ event }) => fqn(event)?.[2],
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

// ── The whole answer ─────────────────────────────────────────────────────────────

// What the top-level rules are handed: the trace already read, sorted and cut. Doing that here rather than
// inside the rules is what lets each slot below be one sentence.
type Answer = {
  ctx: CheckContext;
  /** The offset the ledger end reported. */
  end: number;
  /** Every active contract the node returned, newest first. */
  ordered: Event[];
  /** The part of it that fits on this page. */
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
    "the last shown row when the node returned more than fit, otherwise null",
    (a) => {
      const last = a.shown[a.shown.length - 1];
      const more = a.shown.length < a.ordered.length;
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
    const page = firstN(ordered, pageSizeOf(ctx.url), { totalAt: "matched" });
    const answer: Answer = { ctx, end, ordered, shown: page.shown, mine: myParties(ctx.trace) };
    return { ok: true, pages: [page], body: buildObject(CONTRACTS_RESPONSE, answer) };
  },
};
