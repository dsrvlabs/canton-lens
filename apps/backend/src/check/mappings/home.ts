// **GET /api/home, written out again by hand.**
//
// The home is a summary of **my** workspace, not the network's — two people opening it see different
// numbers, and that is the product's first principle stated as a screen. Three things it upholds, and each
// of them is a rule below:
//
//   ① A viewer with no party rights does not get an empty scoreboard. The whole card row is replaced by one
//      line. **And holding no parties is not the same as holding no rights**: a super reader holds none of
//      their own and reads every party there is, so this is decided on the scope and never on the count.
//   ② Parties and zero contracts is an honest 0. A card whose lookup failed is not 0 — it is unavailable
//      with a reason, because "nothing there" and "we could not look" are different sentences.
//   ③ Cards, list and sparkline are one snapshot: one offset, and the graph is bucketed from the very array
//      the list was cut from, so the two counts cannot drift apart.
//
// Written by reading router.ts and core/home-summary (three files).
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
import {
  acsPagesForInterface,
  arr,
  ledgerEnd,
  myParties,
  num,
  rec,
  str,
  wildcardAcsPages,
  wildcardUpdatePages,
} from "./read-trace.ts";
import { RECENT_UPDATE_EVENT_ROW, RECENT_UPDATE_ROW, readUpdates, type Update } from "./updates.ts";

/** How far back "recent" reaches, and how many of it the list shows. Both constants live in the product. */
const LOOKBACK = 500;
const RECENT_LIMIT = 20;
/** A deadline within a day is drawn as imminent. The design fixed the emphasis; this value is the code's. */
const IMMINENT_MS = 24 * 60 * 60 * 1000;
const PREVIEW_LIMIT = 5;
const BUCKETS = 24;

const HOME_UNAVAILABLE: Record<string, Rule<{ reason: string }>> = {
  status: app(
    "unavailable — this one piece could not be had, while the rest of the snapshot stands",
    () => "unavailable",
  ),
  reason: app("why, by name — never a zero standing in for a failed lookup", (u) => u.reason),
};
const unavailable = (reason: string): unknown => buildObject(HOME_UNAVAILABLE, { reason });

// ── the three cards ──────────────────────────────────────────────────────────────

const COUNT_OK: Record<string, Rule<{ count: number }>> = {
  status: app("ok", () => "ok"),
  count: app(
    "how many active contracts the node returned — zero is a number, not an absence",
    (c) => c.count,
  ),
};
const HOME_COUNT_CARD: Branches = { by: "status", of: [{ when: ["ok"], slots: COUNT_OK }] };

type Preview = {
  contractId: string;
  direction: string;
  transfer: Record<string, unknown>;
  remainingMs: number;
};

const OFFER_PREVIEW: Record<string, Rule<Preview>> = {
  contractId: node("contractId"),
  direction: app(
    "received or internal — the two that are my turn, and the only two that reach this stack",
    (p) => p.direction,
  ),
  sender: app("the view's sender", (p) => str(p.transfer.sender)),
  receiver: app("the view's receiver", (p) => str(p.transfer.receiver)),
  amount: app("the view's amount, as the text the node sent", (p) => str(p.transfer.amount)),
  instrumentId: app(
    "the id inside the standard instrument record, or the view's value as it came when it is not one",
    (p) => {
      const raw = p.transfer.instrumentId;
      const id = str(rec(raw).id);
      return id === null ? raw : id;
    },
  ),
  executeBefore: app("the view's executeBefore, as the text the node sent", (p) =>
    str(p.transfer.executeBefore),
  ),
  remainingMs: app("how long is left before that deadline", (p) => p.remainingMs),
  imminent: app("whether that is within a day", (p) => p.remainingMs <= IMMINENT_MS),
};

const PENDING_OK: Record<
  string,
  Rule<{
    pending: Preview[];
    expiredNotCounted: number;
    problems: number;
  }>
> = {
  status: app("ok", () => "ok"),
  pending: app(
    "how many offers are my turn and not yet expired — the things there are to do",
    (c) => c.pending.length,
  ),
  preview: app(
    "the first five of them, soonest deadline first, contract id breaking a tie so the arrangement is settled",
    (c) => c.pending.slice(0, PREVIEW_LIMIT).map((p) => buildObject(OFFER_PREVIEW, p)),
  ),
  imminent: app(
    "how many of those fall within a day",
    (c) => c.pending.filter((p) => p.remainingMs <= IMMINENT_MS).length,
  ),
  soonestRemainingMs: app("the nearest deadline among them, or null when there are none", (c) =>
    c.pending.length === 0 ? null : Math.min(...c.pending.map((p) => p.remainingMs)),
  ),
  expiredNotCounted: app(
    "how many were my turn and have expired — not counted among the pending, and not hidden either",
    (c) => c.expiredNotCounted,
  ),
  problems: app("how many contracts carried a view that could not be read", (c) => c.problems),
};
const HOME_PENDING_OFFERS_CARD: Branches = {
  by: "status",
  of: [{ when: ["ok"], slots: PENDING_OK }],
};

const TOKENS_OK: Record<string, Rule<{ labels: string[]; problems: number }>> = {
  status: app("ok", () => "ok"),
  kinds: app(
    "how many instruments I hold — the number of groups, not of contracts",
    (t) => t.labels.length,
  ),
  labels: app("their names, in alphabetical order — arrangement, not judgment", (t) => t.labels),
  problems: app("how many contracts carried a view that could not be read", (t) => t.problems),
};
const HOME_TOKENS_CARD: Branches = { by: "status", of: [{ when: ["ok"], slots: TOKENS_OK }] };

type Cards = {
  contracts: number;
  pending: Preview[];
  expiredNotCounted: number;
  offerProblems: number;
  labels: string[];
  tokenProblems: number;
  readsAsAnyParty: boolean;
};

const CARDS_OK: Record<string, Rule<Cards>> = {
  status: app("ok — there is a scope to summarise", () => "ok"),
  activeContracts: app("how many contracts I can see at this offset", (c) =>
    buildObject(COUNT_OK, { count: c.contracts }),
  ),
  // **A super reader has no answer to give here, and the card says so by name.** "Received" and "which
  // instruments I hold" are relative to parties the viewer holds, and this viewer holds none — they read as
  // everyone. That is not zero offers, and passing the empty list on would have counted every offer on the
  // participant as neither received nor sent and quietly reported 0.
  pendingOffers: app(
    "the offers that are my turn, or no_own_parties when there is no 'my' to compute",
    (c) =>
      c.readsAsAnyParty
        ? unavailable("no_own_parties")
        : buildObject(PENDING_OK, {
            pending: c.pending,
            expiredNotCounted: c.expiredNotCounted,
            problems: c.offerProblems,
          }),
  ),
  tokens: app("the instruments I hold, or no_own_parties for the same reason", (c) =>
    c.readsAsAnyParty
      ? unavailable("no_own_parties")
      : buildObject(TOKENS_OK, { labels: c.labels, problems: c.tokenProblems }),
  ),
};
const CARDS_NO_RIGHTS: Record<string, Rule<unknown>> = {
  status: app(
    "no_party_rights — one line instead of a row of zeroes. Decided on the scope and never on the party count, because a super reader holds no parties and reads every one of them",
    () => "no_party_rights",
  ),
};
const HOME_CARDS: Branches = {
  by: "status",
  of: [
    { when: ["ok"], slots: CARDS_OK },
    { when: ["no_party_rights"], slots: CARDS_NO_RIGHTS },
  ],
};

// ── the sparkline ────────────────────────────────────────────────────────────────

type Spark = { times: { ms: number; raw: string }[] };

const SPARK_OK: Record<string, Rule<Spark>> = {
  status: app("ok", () => "ok"),
  count: app(
    "how many updates the window holds — the same N the list reports",
    (s) => s.times.length,
  ),
  from: app(
    "the earliest effective time among them, as the text the node sent",
    (s) => earliest(s).raw,
  ),
  to: app("the latest, likewise", (s) => latest(s).raw),
  buckets: app(
    "twenty-four equal slices of the span between those two, each holding how many fell in it; when every update shares one instant they all pile into the last slice, because nearer to now is on the right",
    (s) => {
      const from = earliest(s).ms;
      const span = latest(s).ms - from;
      const buckets = new Array<number>(BUCKETS).fill(0);
      for (const t of s.times) {
        const at =
          span === 0
            ? BUCKETS - 1
            : Math.min(BUCKETS - 1, Math.floor(((t.ms - from) / span) * BUCKETS));
        buckets[at] = (buckets[at] ?? 0) + 1;
      }
      return buckets;
    },
  ),
};
const SPARK_EMPTY: Record<string, Rule<unknown>> = {
  status: app(
    "empty — not a single update in the window. Named, so the screen can say 'none' rather than draw a zero",
    () => "empty",
  ),
};
const SPARKLINE: Branches = {
  by: "status",
  of: [
    { when: ["ok"], slots: SPARK_OK },
    { when: ["empty"], slots: SPARK_EMPTY },
    { when: ["unavailable"], slots: HOME_UNAVAILABLE },
  ],
};

const earliest = (s: Spark) => s.times.reduce((a, b) => (b.ms < a.ms ? b : a));
const latest = (s: Spark) => s.times.reduce((a, b) => (b.ms > a.ms ? b : a));

// ── the recent list ──────────────────────────────────────────────────────────────

const RECENT_OK: Record<string, Rule<{ updates: Update[]; beginExclusive: number }>> = {
  status: app("ok", () => "ok"),
  rows: app("the twenty newest updates of the window", (r) =>
    r.updates.slice(0, RECENT_LIMIT).map((update) => buildObject(RECENT_UPDATE_ROW, update)),
  ),
  totalInWindow: app(
    "how many the window holds in all — the same N the sparkline reports",
    (r) => r.updates.length,
  ),
  beginExclusive: app(
    "where the window starts, so the screen can say how far back it looked",
    (r) => r.beginExclusive,
  ),
};
const HOME_RECENT: Branches = { by: "status", of: [{ when: ["ok"], slots: RECENT_OK }] };

// ── the whole answer ─────────────────────────────────────────────────────────────

type Answer = {
  ctx: CheckContext;
  end: number;
  userId: string;
  mine: string[];
  scope: string;
  cards: unknown;
  sparkline: unknown;
  recent: unknown;
};

const VIEWER: Record<string, Rule<Answer>> = {
  userId: app("the node's user.id", (a) => a.userId),
  partyCount: app("how many parties of my own my rights name", (a) => a.mine.length),
  scope: app(
    "instance-wide when my rights include CanReadAsAnyParty, own otherwise",
    (a) => a.scope,
  ),
};

const HOME_RESPONSE: Record<string, Rule<Answer>> = {
  readAt: app("the instant the check handed the server as its clock", (a) => a.ctx.now.iso),
  offset: app("the one offset the whole page was read at", (a) => a.end),
  viewer: app("who is asking, by the node's own account", (a) => buildObject(VIEWER, a)),
  cards: app("the card row, or the one line that replaces it", (a) => a.cards),
  sparkline: app("the distribution of the window's updates over time", (a) => a.sparkline),
  recent: app("the newest of them", (a) => a.recent),
};

const sameInterface = (a: string, b: string): boolean => {
  const x = a.split(":");
  const y = b.split(":");
  if (x.length !== 3 || y.length !== 3) return false;
  if (x[1] !== y[1] || x[2] !== y[2]) return false;
  return x[0]?.startsWith("#") || y[0]?.startsWith("#") ? true : x[0] === y[0];
};

/** The node's view of one contract through an interface, when it carries one that could be read. */
const viewValueOf = (
  event: Record<string, unknown>,
  interfaceId: string,
): { value: Record<string, unknown> } | { problem: true } | null => {
  const view = arr(event.interfaceViews).find((v) => {
    const id = str(rec(v).interfaceId);
    return id !== null && sameInterface(id, interfaceId);
  });
  if (view === undefined) return null;
  const status = rec(rec(view).viewStatus);
  if (num(status.code) !== 0) return { problem: true };
  return { value: rec(rec(view).viewValue) };
};

export const homeMapping: Mapping<CheckContext> = {
  root: "HomeResponse",
  slots: {
    HomeResponse: HOME_RESPONSE,
    HomeCards: HOME_CARDS,
    HomeCountCard: HOME_COUNT_CARD,
    HomePendingOffersCard: HOME_PENDING_OFFERS_CARD,
    HomeTokensCard: HOME_TOKENS_CARD,
    HomeOfferPreview: OFFER_PREVIEW,
    HomeUnavailable: HOME_UNAVAILABLE,
    UpdateTimeDistribution: SPARKLINE,
    HomeRecent: HOME_RECENT,
    RecentUpdateRow: RECENT_UPDATE_ROW,
    RecentUpdateEventRow: RECENT_UPDATE_EVENT_ROW,
  },
  expected: (ctx): Expectation => {
    const end = ledgerEnd(ctx.trace);
    if (end === null) return { ok: false, why: "the trace holds no ledger end" };
    const query = new URL(ctx.url, "http://check").searchParams;
    const asOfMs = Date.parse(query.get("asOf") ?? "");
    const offerInterfaceId = query.get("interfaceId");
    const holdingInterfaceId = query.get("holdingInterfaceId");
    if (Number.isNaN(asOfMs) || offerInterfaceId === null || holdingInterfaceId === null) {
      return {
        ok: false,
        why: "these rules describe only the address the screen asks: an instant and both interfaces",
      };
    }
    const user = ctx.trace.find((call) => call.path === "/v2/authenticated-user")?.answer;
    if (user === undefined) return { ok: false, why: "the trace holds no authenticated-user call" };
    const userId = str(rec(rec(user).user).id) ?? "";
    const mine = myParties(ctx.trace);
    const rights = ctx.trace.find((call) => call.path.endsWith("/rights"))?.answer;
    const readsEveryParty = arr(rec(rights).rights).some((item) => {
      const kind = rec(rec(item).kind);
      const value = rec(kind.CanReadAsAnyParty).value;
      const named = ["CanReadAs", "CanActAs"].some(
        (c) => str(rec(rec(kind[c]).value).party) !== null,
      );
      return !named && typeof value === "object" && value !== null && !Array.isArray(value);
    });
    const scope = readsEveryParty ? "instance-wide" : "own";
    const readsAsAnyParty = mine.length === 0 && readsEveryParty;

    const base: Omit<Answer, "cards" | "sparkline" | "recent"> = { ctx, end, userId, mine, scope };

    // ① Nothing to ask the node with. The cards say so, and so do the other two pieces — an empty answer is
    // not offered where no question was put.
    if (mine.length === 0 && !readsEveryParty) {
      return {
        ok: true,
        pages: [],
        body: buildObject(HOME_RESPONSE, {
          ...base,
          cards: buildObject(CARDS_NO_RIGHTS, undefined),
          sparkline: unavailable("no_party_rights"),
          recent: unavailable("no_party_rights"),
        }),
      };
    }

    const acs = wildcardAcsPages(ctx.trace);
    if (acs.length === 0)
      return { ok: false, why: "the trace holds no unnarrowed active-contracts call" };
    let contracts = 0;
    for (const page of acs) contracts += arr(page.answer).length;

    // The two interface reads. A super reader's cards say no_own_parties instead, but the node is asked all
    // the same — so the pages are read whether or not they are used.
    const pending: Preview[] = [];
    let expiredNotCounted = 0;
    let offerProblems = 0;
    for (const page of acsPagesForInterface(ctx.trace, offerInterfaceId)) {
      for (const item of arr(page.answer)) {
        const event = rec(rec(rec(rec(item).contractEntry).JsActiveContract).createdEvent);
        const contractId = str(event.contractId);
        if (contractId === null) continue;
        const found = viewValueOf(event, offerInterfaceId);
        if (found === null) continue;
        if ("problem" in found) {
          offerProblems += 1;
          continue;
        }
        const transfer =
          typeof found.value.transfer === "object" && found.value.transfer !== null
            ? rec(found.value.transfer)
            : found.value;
        const sender = str(transfer.sender);
        const receiver = str(transfer.receiver);
        if (
          sender === null ||
          receiver === null ||
          str(transfer.amount) === null ||
          str(transfer.executeBefore) === null
        ) {
          offerProblems += 1;
          continue;
        }
        // Only the two directions that are my turn reach this card at all.
        const isSender = mine.includes(sender);
        const isReceiver = mine.includes(receiver);
        if (!isReceiver) continue;
        const direction = isSender ? "internal" : "received";
        const atMs = Date.parse(str(transfer.executeBefore) ?? "");
        if (Number.isNaN(atMs) || atMs <= asOfMs) {
          expiredNotCounted += 1;
          continue;
        }
        pending.push({ contractId, direction, transfer, remainingMs: atMs - asOfMs });
      }
    }
    pending.sort((a, b) =>
      a.remainingMs !== b.remainingMs
        ? a.remainingMs - b.remainingMs
        : a.contractId < b.contractId
          ? -1
          : 1,
    );

    const labels = new Map<string, string>();
    let tokenProblems = 0;
    for (const page of acsPagesForInterface(ctx.trace, holdingInterfaceId)) {
      for (const item of arr(page.answer)) {
        const event = rec(rec(rec(rec(item).contractEntry).JsActiveContract).createdEvent);
        if (str(event.contractId) === null) continue;
        const found = viewValueOf(event, holdingInterfaceId);
        if (found === null) continue;
        if ("problem" in found) {
          tokenProblems += 1;
          continue;
        }
        const owner = str(found.value.owner);
        const raw = found.value.instrumentId;
        let key: string | null = null;
        let label = "";
        if (typeof raw === "string" && raw !== "") {
          key = raw;
          label = raw;
        } else if (str(rec(raw).id) !== null && rec(raw).id !== "") {
          const admin = str(rec(raw).admin) ?? "";
          label = str(rec(raw).id) ?? "";
          key = admin === "" ? label : `${admin}:${label}`;
        }
        if (owner === null || key === null) {
          tokenProblems += 1;
          continue;
        }
        // Somebody else's holdings are not my kinds. Not an error — simply not what this card counts.
        if (!mine.includes(owner)) continue;
        if (!labels.has(key)) labels.set(key, label);
      }
    }
    const sortedLabels = [...labels.entries()]
      .sort(([ak, al], [bk, bl]) => (al < bl ? -1 : al > bl ? 1 : ak < bk ? -1 : 1))
      .map(([, label]) => label);

    const read = readUpdates(wildcardUpdatePages(ctx.trace));
    if ("why" in read) return { ok: false, why: read.why };
    const updates = [...read.updates].sort(
      (a, b) => (num(b.value.offset) ?? 0) - (num(a.value.offset) ?? 0),
    );
    const times = updates.map((u) => ({
      ms: Date.parse(str(u.value.effectiveAt) ?? ""),
      raw: str(u.value.effectiveAt) ?? "",
    }));
    if (times.some((t) => Number.isNaN(t.ms))) {
      return {
        ok: false,
        why: "an update's effective time cannot be read, and these rules do not describe that",
      };
    }

    const cards: Cards = {
      contracts,
      pending,
      expiredNotCounted,
      offerProblems,
      labels: sortedLabels,
      tokenProblems,
      readsAsAnyParty,
    };
    return {
      ok: true,
      pages: [],
      body: buildObject(HOME_RESPONSE, {
        ...base,
        cards: buildObject(CARDS_OK, cards),
        sparkline:
          times.length === 0
            ? buildObject(SPARK_EMPTY, undefined)
            : buildObject(SPARK_OK, { times }),
        recent: buildObject(RECENT_OK, { updates, beginExclusive: Math.max(0, end - LOOKBACK) }),
      }),
    };
  },
};
