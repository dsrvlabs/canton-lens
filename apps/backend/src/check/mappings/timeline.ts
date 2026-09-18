// **GET /api/timeline, written out again by hand.**
//
// A timeline bar is a claim about when a contract began and when it ended, so this answer is built from two
// reads at one offset: the updates of the window (what was created and archived inside it) and the active
// contracts (what is alive at its end). The rules below were written by reading router.ts and
// core/timeline/build-lifelines.ts and stating again what they do; nothing here calls them.
//
// **Three states, not two.** An archived event carries no signatories or observers — only witnessParties —
// so a contract can leave the window without its end being visible. "No archive seen" therefore splits into
// `alive` (it is in the active contracts) and `unknown` (it is not, and we cannot say why). Calling the
// second one alive would be inventing a fact, and a rule that did so would have to be written here too.
import {
  ABSENT,
  app,
  buildObject,
  type CheckContext,
  type Expectation,
  type Mapping,
  node,
  type Rule,
} from "../mapping.ts";
import {
  arr,
  fqn,
  ledgerEnd,
  myParties,
  num,
  rec,
  str,
  stringsOf,
  wildcardAcsPages,
  wildcardUpdatePages,
} from "./read-trace.ts";

/** The width drawn when the query names no start. `TIMELINE_DEFAULT_SPAN` in router.ts. */
const DEFAULT_SPAN = 100;

// ── One bar ──────────────────────────────────────────────────────────────────────

/** What one contract's bar is made of, gathered before the rules run so each rule is one sentence. */
type Line = {
  contractId: string;
  /** The template and stakeholders, from the active contract when there is one, else from the first event. */
  from: {
    package: string;
    packageName: string | null;
    module: string;
    entity: string;
    parties: string[];
  };
  /** The creating event seen inside the window. */
  born: { offset: number; updateId: string; effectiveAt: string } | null;
  /** The archiving event seen inside the window. */
  died: { offset: number; updateId: string; effectiveAt: string } | null;
  /** The active contract, when this one is still alive at the end of the window. */
  living: { offset: number | null; createdAt: string | null } | null;
  window: { from: number; to: number };
};

/** Where the bar starts, and whether that point is the contract's birth or only the window's edge. */
const bornAt = (line: Line): number | null => line.born?.offset ?? line.living?.offset ?? null;
const startKnown = (line: Line): boolean => {
  const at = bornAt(line);
  return at !== null && at >= line.window.from;
};

const LIFELINE: Record<string, Rule<Line>> = {
  contractId: node("contractId"),
  package: app(
    "the first of the three colon-separated parts of the templateId — the active contract's when it is alive, otherwise the first event's",
    (l) => l.from.package,
  ),
  packageName: app(
    "the active contract's packageName, and null for a contract seen only as an event — an event carries no package name",
    (l) => l.from.packageName,
  ),
  module: app("the second of the three parts of that same templateId", (l) => l.from.module),
  entity: app("the third of the three parts of that same templateId", (l) => l.from.entity),
  parties: app(
    "for a contract that is alive, my own parties in the order my rights list them followed by the other stakeholders; for one seen only as a creation, the node's signatories and observers; empty when the only thing seen was an archive, which carries neither",
    (l) => l.from.parties,
  ),
  start: app(
    "the offset it was created at when that is inside the window, otherwise the window's first offset",
    (l) => (startKnown(l) ? bornAt(l) : l.window.from),
  ),
  startKnown: app(
    "true only when a creation offset is known and it is not before the window — the bar is pulled to the edge otherwise, and this says the edge is not its birth",
    startKnown,
  ),
  end: app(
    "the offset it was archived at, or the window's last offset when no archive was seen",
    (l) => l.died?.offset ?? l.window.to,
  ),
  endKnown: app("true only when an archive was seen inside the window", (l) => l.died !== null),
  // `unknown` is not reached by an unfiltered window and mutation confirms it: with no narrowing, a contract
  // whose creation is visible has its archive visible too, so everything is `alive` or `archived`. The third
  // state exists for a *party-filtered* window, where an archive can be invisible — and these rules do not
  // describe a filtered question yet, so nothing here exercises it.
  state: app(
    "archived when an archive was seen, alive when it is among the active contracts, unknown otherwise",
    (l) => (l.died !== null ? "archived" : l.living !== null ? "alive" : "unknown"),
  ),
  archivedBy: app(
    "the id of the update that archived it, or null — an archived contract has no detail page, so this is where the screen can go instead",
    (l) => l.died?.updateId ?? null,
  ),
  createdAt: app(
    "the active contract's createdAt, or the effective time of the creating update, or null when neither was seen",
    (l) => l.living?.createdAt ?? l.born?.effectiveAt ?? null,
  ),
};

const LIFELINE_GROUP: Record<string, Rule<{ key: string; lines: Line[] }>> = {
  key: app("the module and entity of the template, joined by a colon", (g) => g.key),
  module: app("the part of that key before the colon", (g) => g.key.split(":")[0]),
  entity: app("the part of that key after the colon", (g) => g.key.split(":")[1]),
  lines: app(
    "the bars of that template, earliest start first and contract id breaking a tie",
    (g) => g.lines.map((line) => buildObject(LIFELINE, line)),
  ),
};

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

type Answer = {
  ctx: CheckContext;
  end: number;
  from: number;
  groups: { key: string; lines: Line[] }[];
};

const TIMELINE_RESPONSE: Record<string, Rule<Answer>> = {
  groups: app("one group per template, the biggest crowd first and the key breaking a tie", (a) =>
    a.groups.map((group) => buildObject(LIFELINE_GROUP, group)),
  ),
  total: app("how many bars there are across every group", (a) =>
    a.groups.reduce((n, g) => n + g.lines.length, 0),
  ),
  from: app(
    "the first offset of the window: the one the query asked for, or a hundred back from the end",
    (a) => a.from,
  ),
  filter: app("the filter the query asked for", (a) => buildObject(UPDATE_FILTER, a.ctx)),
  offset: app("the offset the ledger end reported", (a) => a.end),
  readAt: app("the instant the check handed the server as its clock", (a) => a.ctx.now.iso),
};

export const timelineMapping: Mapping<CheckContext> = {
  root: "TimelineResponse",
  slots: {
    TimelineResponse: TIMELINE_RESPONSE,
    LifelineGroup: LIFELINE_GROUP,
    Lifeline: LIFELINE,
    UpdateFilter: UPDATE_FILTER,
  },
  expected: (ctx): Expectation => {
    const end = ledgerEnd(ctx.trace);
    if (end === null) {
      return { ok: false, why: "the trace holds no ledger end, so the window is unknown" };
    }
    const asked = new URL(ctx.url, "http://check").searchParams.get("from");
    // The window is [from, offset], both ends included — that is how the screen's two boxes read. Only the
    // ledger call uses an exclusive start.
    const from =
      asked !== null && /^[0-9]+$/.test(asked)
        ? Number.parseInt(asked, 10)
        : Math.max(0, end - DEFAULT_SPAN) + 1;
    const filter = buildObject(UPDATE_FILTER, ctx) as Record<string, unknown>;
    if (Object.keys(filter).length > 0) {
      return { ok: false, why: "these rules do not describe a filtered question yet" };
    }
    // An empty ledger has no range to ask about, and the answer says so with a window of zero — not with the
    // window that was asked for.
    if (end <= 0) {
      return {
        ok: true,
        pages: [],
        body: { groups: [], total: 0, offset: end, from: 0, filter, readAt: ctx.now.iso },
      };
    }

    // ── what the window says was created and archived ──────────────────────────────
    const born = new Map<string, { offset: number; updateId: string; effectiveAt: string }>();
    const died = new Map<string, { offset: number; updateId: string; effectiveAt: string }>();
    const seenAs = new Map<string, Line["from"]>();
    for (const page of wildcardUpdatePages(ctx.trace)) {
      for (const item of arr(page.answer)) {
        const value = rec(rec(rec(rec(item).update).Transaction).value);
        const updateId = str(value.updateId);
        const offset = num(value.offset);
        const effectiveAt = str(value.effectiveAt);
        if (updateId === null || offset === null || effectiveAt === null) continue;
        for (const rawEvent of arr(value.events)) {
          const created = rec(rawEvent).CreatedEvent;
          const archived = rec(rawEvent).ArchivedEvent;
          const source = rec(created ?? archived ?? {});
          const contractId = str(source.contractId);
          const parts = fqn(source.templateId);
          if (contractId === null || parts === null) continue;
          const at = { offset, updateId, effectiveAt };
          // A contract is created once and archived once; if overlapping windows ever arrive, the earliest
          // is the one kept.
          const into = created !== undefined ? born : died;
          const before = into.get(contractId);
          if (before === undefined || at.offset < before.offset) into.set(contractId, at);
          // **A creation is the better of the two events, and it is not the one seen first.** The node's
          // pages run oldest-first here, but the product reads the window newest-first, so for a contract
          // created and archived inside one window the archive is what it meets first — and an archive
          // carries no signatories or observers. Whichever order the material arrives in, the creation is
          // the event that knows the stakeholders, so it is the one that wins.
          //
          // For a while the product had this wrong, the fix went in, and this restatement still said the old
          // thing — and both were green, because nothing in the window had both events. The seed holds such a
          // lifecycle now and the recording is required to keep holding one (check/conditions.ts): reverting
          // the product's fix goes red in forty-five places.
          const already = seenAs.get(contractId);
          if (already === undefined || (created !== undefined && already.parties.length === 0)) {
            seenAs.set(contractId, {
              package: parts[0],
              packageName: null,
              module: parts[1],
              entity: parts[2],
              // A creation carries signatories and observers; an archive carries neither, and a witness is
              // not a stakeholder — so that one contributes no parties at all.
              parties:
                created !== undefined
                  ? [
                      ...new Set([
                        ...stringsOf(rec(created).signatories),
                        ...stringsOf(rec(created).observers),
                      ]),
                    ]
                  : [],
            });
          }
        }
      }
    }

    // ── what is alive at the end of the window ─────────────────────────────────────
    const acsPages = wildcardAcsPages(ctx.trace);
    if (acsPages.length === 0) {
      return { ok: false, why: "the trace holds no unnarrowed active-contracts call" };
    }
    const mine = myParties(ctx.trace);
    const living = new Map<string, { offset: number | null; createdAt: string | null }>();
    for (const page of acsPages) {
      for (const item of arr(page.answer)) {
        const entry = rec(rec(item).contractEntry);
        if (entry.JsActiveContract === undefined) {
          const kinds = Object.keys(entry).join(",") || "(empty)";
          return {
            ok: false,
            why: `an active-contracts entry is not a JsActiveContract: ${kinds}`,
          };
        }
        const event = rec(rec(entry.JsActiveContract).createdEvent);
        const contractId = str(event.contractId);
        const parts = fqn(event.templateId);
        if (contractId === null || parts === null) continue;
        const signatories = stringsOf(event.signatories);
        const observers = stringsOf(event.observers);
        const involved = [...new Set([...signatories, ...observers])];
        living.set(contractId, { offset: num(event.offset), createdAt: str(event.createdAt) });
        // The active contract is the better source where both exist: it carries the package name, and it
        // knows the creation offset of a contract made before the window.
        seenAs.set(contractId, {
          package: parts[0],
          packageName: str(event.packageName),
          module: parts[1],
          entity: parts[2],
          // Mine first — on my screen the answer to "whose is this" starts with whether it is mine.
          parties: [
            ...mine.filter((p) => involved.includes(p)),
            ...involved.filter((p) => !mine.includes(p)),
          ],
        });
      }
    }

    const window = { from, to: end };
    const lines: Line[] = [...seenAs].map(([contractId, seen]) => ({
      contractId,
      from: seen,
      born: born.get(contractId) ?? null,
      died: died.get(contractId) ?? null,
      living: living.get(contractId) ?? null,
      window,
    }));

    const grouped = new Map<string, { key: string; lines: Line[] }>();
    for (const line of lines) {
      const key = `${line.from.module}:${line.from.entity}`;
      const group = grouped.get(key) ?? { key, lines: [] };
      group.lines.push(line);
      grouped.set(key, group);
    }
    for (const group of grouped.values()) {
      group.lines.sort(
        (a, b) =>
          (startKnown(a) ? (bornAt(a) ?? from) : from) -
            (startKnown(b) ? (bornAt(b) ?? from) : from) ||
          a.contractId.localeCompare(b.contractId),
      );
    }
    const groups = [...grouped.values()].sort(
      (a, b) => b.lines.length - a.lines.length || a.key.localeCompare(b.key),
    );
    // **Nothing is cut here.** A timeline draws a range, so the whole window is the answer; there is no page
    // to declare and so no `pages` entry.
    return {
      ok: true,
      pages: [],
      body: buildObject(TIMELINE_RESPONSE, { ctx, end, from, groups }),
    };
  },
};
