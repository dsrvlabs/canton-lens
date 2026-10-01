// **GET /api/updates/after/{offset}, written out again by hand.**
//
// The live feed's question. Where /api/updates asks for a window wide enough to hold "recent", this asks for
// every update in one range — (after, ledgerEnd] — and nothing is filtered or cut. The rules for a row are
// the list's own (updates.ts), imported rather than restated: what an update *is* cannot depend on which
// address named it. What is restated here is the range, and the one bound on it.
//
// The node side is three questions: the ledger end, the authenticated user and their rights, and — when the
// range is not empty — the updates of that range, in pages.
import {
  app,
  buildObject,
  type CheckContext,
  type Expectation,
  type Mapping,
  type Rule,
} from "../mapping.ts";
import { ledgerEnd, num, wildcardUpdatePages } from "./read-trace.ts";
import {
  RECENT_UPDATE_EVENT_ROW,
  RECENT_UPDATE_ROW,
  readUpdates,
  refusedStep,
  type Update,
} from "./updates.ts";

/** The most offsets one answer reads back from the ledger end — `UPDATES_AFTER_MAX_SPAN` in router.ts, restated. */
const MAX_SPAN = 2_000;

type Answer = {
  ctx: CheckContext;
  end: number;
  /** The offset the address named. */
  after: number;
  /** Every update of the range that kept at least one event, newest first. */
  ordered: Update[];
};

const UPDATES_AFTER_RESPONSE: Record<string, Rule<Answer>> = {
  rows: app(
    "every update of the range that kept an event, newest offset first — nothing filtered, nothing cut",
    (a) => a.ordered.map((update) => buildObject(RECENT_UPDATE_ROW, update)),
  ),
  beginExclusive: app(
    "the offset the address names, or two thousand before the ledger end when the address names something older than that",
    (a) => Math.max(a.after, a.end - MAX_SPAN),
  ),
  offset: app("the offset the ledger end reported", (a) => a.end),
  readAt: app("the instant the check handed the server as its clock", (a) => a.ctx.now.iso),
};

/** The offset the address names — its last segment. */
const askedAfter = (url: string): number | null => {
  const found = /\/api\/updates\/after\/(\d+)(?:\?|$)/.exec(url);
  return found?.[1] === undefined ? null : Number.parseInt(found[1], 10);
};

export const updatesAfterMapping: Mapping<CheckContext> = {
  root: "UpdatesAfterResponse",
  slots: {
    UpdatesAfterResponse: UPDATES_AFTER_RESPONSE,
    RecentUpdateRow: RECENT_UPDATE_ROW,
    RecentUpdateEventRow: RECENT_UPDATE_EVENT_ROW,
  },
  expected: (ctx): Expectation => {
    const end = ledgerEnd(ctx.trace);
    if (end === null) {
      return { ok: false, why: "the trace holds no ledger end, so the range is unknown" };
    }
    const after = askedAfter(ctx.url);
    if (after === null) return { ok: false, why: "the address names no offset" };
    const answer = (ordered: Update[]): Expectation => ({
      ok: true,
      body: buildObject(UPDATES_AFTER_RESPONSE, { ctx, end, after, ordered }),
    });
    // (end, end] is empty and the product does not send it, so there is no node call to read — and none may
    // be there: a call in the trace would be a question the product had no reason to ask.
    if (Math.max(after, end - MAX_SPAN) >= end) {
      if (wildcardUpdatePages(ctx.trace).length > 0) {
        return { ok: false, why: "the range is empty and yet the node was asked for updates" };
      }
      return answer([]);
    }
    const pages = wildcardUpdatePages(ctx.trace);
    if (pages.length === 0) return { ok: false, why: "the trace holds no unnarrowed updates call" };
    if (refusedStep(pages)) {
      return { ok: false, why: "the node refused the range, and these rules do not describe that" };
    }
    const read = readUpdates(pages);
    if ("why" in read) return { ok: false, why: read.why };
    // Newest first, by offset alone — an offset is a total order within one participant.
    const ordered = [...read.updates].sort(
      (a, b) => (num(b.value.offset) ?? 0) - (num(a.value.offset) ?? 0),
    );
    return answer(ordered);
  },
};
