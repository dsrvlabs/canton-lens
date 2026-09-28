// **GET /api/updates, written out again by hand.**
//
// This screen says what the active contracts cannot: what *stopped* existing. Its rules were written by
// reading router.ts (the handler), envelope.ts (`toUpdateEntries`) and core/recent-updates (the two
// functions that build and then page the rows) and stating again what they do. Nothing here calls them.
//
// The node side is four questions: the ledger end, the authenticated user and their rights, and the updates
// of one offset window, which arrive in pages.
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
import {
  arr,
  fqn,
  ledgerEnd,
  num,
  rec,
  str,
  stringsOf,
  wildcardUpdatePages,
} from "./read-trace.ts";

// **How far back "recent" reaches — the schedule in core's request-recent-updates.ts, stated again.** The
// window starts LOOKBACK offsets before the ledger end. While it holds fewer than TARGET transactions and
// has not reached the ledger's start, it widens WIDEN-fold, up to MAX_LOOKBACK. The product reads each step
// as a separate node call; these rules only need where the window ended up.
const LOOKBACK = 500;
const TARGET = 500;
const WIDEN = 4;
const MAX_LOOKBACK = 128_000;

/** The offsets of the transactions the node's pages hold — every step's, together. */
const transactionOffsets = (pages: readonly { answer: unknown }[]): number[] =>
  pages.flatMap((page) =>
    arr(page.answer)
      .map((item) => num(rec(rec(rec(rec(item).update).Transaction).value).offset))
      .filter((offset): offset is number => offset !== null),
  );

/**
 * Where the recent window starts, worked out from what the node's pages hold. Exported for the home
 * mapping, which reads the same window.
 */
export function recentWindowBegin(end: number, pages: readonly { answer: unknown }[]): number {
  const offsets = transactionOffsets(pages);
  let lookback = LOOKBACK;
  while (
    offsets.filter((offset) => offset > end - lookback).length < TARGET &&
    end - lookback > 0 &&
    lookback < MAX_LOOKBACK
  ) {
    lookback = Math.min(MAX_LOOKBACK, lookback * WIDEN);
  }
  return Math.max(0, end - lookback);
}

/**
 * A step the node refused ends the product's widening where it stands, and the pages then hold less than
 * the schedule above would read. These rules do not describe that window, so the mapping says so by name.
 */
export const refusedStep = (pages: readonly { status: number }[]): boolean =>
  pages.some((page) => page.status !== 200);
/** The page the list is cut to when the query asks for no other. `UPDATES_PAGE_SIZE` in core. */
const DEFAULT_LIMIT = 25;

// ── One event of one update ──────────────────────────────────────────────────────

/**
 * What the envelope keeps of a node event. **Both event kinds land in one shape, and the two are not the
 * same underneath**: a created event carries signatories and observers, an archived event carries neither —
 * only witnessParties — and the envelope copies whichever side is there into one `parties`. The name does
 * not change with the meaning, so the difference is written out in the rules below rather than implied.
 */
export type UpdateEvent = {
  created: Record<string, unknown> | null;
  archived: Record<string, unknown> | null;
  source: Record<string, unknown>;
};

export const RECENT_UPDATE_EVENT_ROW: Record<string, Rule<UpdateEvent>> = {
  kind: app(
    "created when the node's event is a CreatedEvent, archived when it is an ArchivedEvent",
    (e) => (e.created !== null ? "created" : "archived"),
  ),
  contractId: node("source.contractId"),
  package: app(
    "the first of the three colon-separated parts of the node's templateId (a package id, not a name)",
    (e) => fqn(e.source.templateId)?.[0],
  ),
  module: app(
    "the second of the three parts of the node's templateId",
    (e) => fqn(e.source.templateId)?.[1],
  ),
  entity: app(
    "the third of the three parts of the node's templateId",
    (e) => fqn(e.source.templateId)?.[2],
  ),
  parties: app(
    "for a created event the node's signatories then its observers, each kept at its first appearance; for an archived event the node's witnessParties, which is all that event carries",
    (e) =>
      e.created !== null
        ? [...new Set([...stringsOf(e.created.signatories), ...stringsOf(e.created.observers)])]
        : stringsOf(e.source.witnessParties),
  ),
  witnessParties: app(
    "the node's witnessParties, or an empty list when the node sent none or sent something that is not a list of strings",
    (e) => stringsOf(e.source.witnessParties),
  ),
};

// ── One update ───────────────────────────────────────────────────────────────────

/** A node transaction and the events of it that survived. */
export type Update = { value: Record<string, unknown>; events: UpdateEvent[] };

export const RECENT_UPDATE_ROW: Record<string, Rule<Update>> = {
  updateId: node("value.updateId"),
  offset: node("value.offset"),
  effectiveAt: node("value.effectiveAt"),
  events: app("one row per event of this transaction, in the node's order", (u) =>
    u.events.map((event) => buildObject(RECENT_UPDATE_EVENT_ROW, event)),
  ),
  submittedByYou: app(
    "true when the node sent a commandId that is not the empty string — a field the node sends only to the party that submitted",
    (u) => str(u.value.commandId) !== null && u.value.commandId !== "",
  ),
};

// ── The filter ───────────────────────────────────────────────────────────────────

const UPDATE_FILTER: Record<string, Rule<CheckContext>> = {
  template: app("the query's template, absent when it was not asked for or was empty", (ctx) => {
    const asked = new URL(ctx.url, "http://check").searchParams.get("template");
    return asked === null || asked === "" ? ABSENT : asked;
  }),
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

// ── The whole answer ─────────────────────────────────────────────────────────────

type Answer = {
  ctx: CheckContext;
  end: number;
  /** Where the window the node was asked for starts, worked out from the pages by recentWindowBegin. */
  beginExclusive: number;
  /** Every update of the window that kept at least one event, newest first. */
  ordered: Update[];
  shown: Update[];
};

const UPDATES_RESPONSE: Record<string, Rule<Answer>> = {
  rows: app("one row per update of the window, newest offset first, cut to the page size", (a) =>
    a.shown.map((update) => buildObject(RECENT_UPDATE_ROW, update)),
  ),
  beginExclusive: app(
    "five hundred before the offset this was read at, widened fourfold — 2,000 · 8,000 · 32,000 · 128,000 — while the window held fewer than five hundred transactions and had not reached the ledger's start; zero when the ledger is not that long",
    (a) => a.beginExclusive,
  ),
  total: app(
    "how many updates of the window kept an event, before any filter",
    (a) => a.ordered.length,
  ),
  matched: app("how many of them pass the query's filter", (a) => a.ordered.length),
  nextBefore: app(
    "the last shown row's offset when more passed the filter than fit on the page, otherwise null",
    (a) => {
      const last = a.shown[a.shown.length - 1];
      const more = a.shown.length < a.ordered.length;
      return more && last !== undefined ? num(last.value.offset) : null;
    },
  ),
  filter: app("the filter the query asked for", (a) => buildObject(UPDATE_FILTER, a.ctx)),
  offset: app("the offset the ledger end reported", (a) => a.end),
  readAt: app("the instant the check handed the server as its clock", (a) => a.ctx.now.iso),
};

/** The answer to an empty ledger — no range to ask the node about, so nothing is asked. */
const emptyLedger = (ctx: CheckContext): unknown => ({
  rows: [],
  offset: 0,
  beginExclusive: 0,
  total: 0,
  matched: 0,
  nextBefore: null,
  filter: buildObject(UPDATE_FILTER, ctx),
  readAt: ctx.now.iso,
});

/**
 * The transactions of a window, read out of the node's pages. Shared with the home mapping, which reads the
 * same window for its list and its sparkline — the reading is plumbing; the rules above are not.
 */
export function readUpdates(
  pages: readonly { answer: unknown }[],
): { updates: Update[] } | { why: string } {
  const updates: Update[] = [];
  for (const page of pages) {
    for (const item of arr(page.answer)) {
      // Anything that is not a transaction — a reassignment, a checkpoint, a topology change — is passed
      // over. It is not an error and it is not a row.
      const value = rec(rec(rec(rec(item).update).Transaction).value);
      if (Object.keys(value).length === 0) continue;
      const events: UpdateEvent[] = [];
      for (const rawEvent of arr(value.events)) {
        const created = rec(rawEvent).CreatedEvent;
        const archived = rec(rawEvent).ArchivedEvent;
        const source = created ?? archived;
        if (source === undefined) {
          // An exercised event, say. The envelope refuses the whole call rather than dropping it, so there
          // is no expected body to compare — the answer would be a 502, a different judgment from this one.
          return { why: "an update event is neither a CreatedEvent nor an ArchivedEvent" };
        }
        events.push({
          created: created === undefined ? null : rec(created),
          archived: archived === undefined ? null : rec(archived),
          source: rec(source),
        });
      }
      // **An update with no event I can see is not a row.** An empty row has nothing to say.
      if (events.length === 0) continue;
      updates.push({ value, events });
    }
  }
  return { updates };
}

export const updatesMapping: Mapping<CheckContext> = {
  root: "UpdatesResponse",
  slots: {
    UpdatesResponse: UPDATES_RESPONSE,
    RecentUpdateRow: RECENT_UPDATE_ROW,
    RecentUpdateEventRow: RECENT_UPDATE_EVENT_ROW,
    UpdateFilter: UPDATE_FILTER,
  },
  expected: (ctx): Expectation => {
    const end = ledgerEnd(ctx.trace);
    if (end === null) {
      return { ok: false, why: "the trace holds no ledger end, so the window is unknown" };
    }
    if (end <= 0) return { ok: true, pages: [], body: emptyLedger(ctx) };

    // **These rules describe the unfiltered question only.** A filtered one would be compared against a
    // count nobody derived — green while looking at nothing.
    const filter = buildObject(UPDATE_FILTER, ctx) as Record<string, unknown>;
    if (Object.keys(filter).length > 0) {
      return { ok: false, why: "these rules do not describe a filtered question yet" };
    }
    const pages = wildcardUpdatePages(ctx.trace);
    if (pages.length === 0) return { ok: false, why: "the trace holds no unnarrowed updates call" };
    if (refusedStep(pages)) {
      return {
        ok: false,
        why: "the node refused a step of the window, and these rules do not describe where the window then starts",
      };
    }
    const read = readUpdates(pages);
    if ("why" in read) return { ok: false, why: read.why };
    const updates = read.updates;
    // Newest first, by offset alone — an offset is a total order within one participant, so no two updates
    // share one and no tiebreak is needed.
    const ordered = [...updates].sort(
      (a, b) => (num(b.value.offset) ?? 0) - (num(a.value.offset) ?? 0),
    );
    const asked = new URL(ctx.url, "http://check").searchParams.get("limit");
    const limit =
      asked !== null && /^[1-9][0-9]*$/.test(asked) ? Number.parseInt(asked, 10) : DEFAULT_LIMIT;
    const page = firstN(ordered, limit, { totalAt: "matched" });
    const answer: Answer = {
      ctx,
      end,
      beginExclusive: recentWindowBegin(end, pages),
      ordered,
      shown: page.shown,
    };
    return { ok: true, pages: [page], body: buildObject(UPDATES_RESPONSE, answer) };
  },
};
