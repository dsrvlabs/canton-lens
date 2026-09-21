// **Transaction detail** — a **point lookup** (LEDGER_EFFECTS). It opens even outside the list's
// window as long as the participant keeps it; a pruned past the server names pruned. Arguments are Raw
// JSON from here on — the decoder is "more human words", not a precondition for showing them. The
// signed hash is not shown merged with the update id (it gets its own row).

import { groupUpdateViews, type UpdateViewGroup } from "@canton-lens/core";
import {
  Badge,
  Banner,
  Button,
  DescriptionList,
  Disclosure,
  Mono,
  Muted,
  Scroll,
  Section,
  SectionBody,
  Table,
} from "@canton-lens/design-system";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { messageOf } from "../api/client.ts";
import { saidSchema } from "../api/said.ts";
import type { TxEvent, TxResponse } from "../api/types.ts";
import { Chip, ContractLink, PartyChip, PartyList } from "../format/chips.tsx";
import { short, shortParty } from "../format/format.ts";
import { NoType, RawJson, TypedFields } from "../format/typed.tsx";
import { useSession } from "../session/SessionContext.tsx";

export type TxRef = { updateId: string } | { offset: string };

export function TxDetail({ target }: { target: TxRef }) {
  const { api, loading, generation } = useSession();
  const [v, setV] = useState<TxResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path =
    "offset" in target
      ? `/api/updates/by-offset/${encodeURIComponent(target.offset)}`
      : `/api/updates/${encodeURIComponent(target.updateId)}`;

  const ran = useRef<string | null>(null);
  useEffect(() => {
    if (loading) return;
    const key = `${generation}|${path}`;
    if (ran.current === key) return;
    ran.current = key;
    let cancelled = false;
    setV(null);
    setError(null);
    api<TxResponse>(path).then(
      (res) => {
        if (cancelled) return;
        setV(res);
      },
      (e: unknown) => {
        if (!cancelled) setError(messageOf(e));
      },
    );
    return () => {
      cancelled = true;
      // An abandoned run clears its own marker (ran) — left behind, a re-entering run with the same key turns
      // back saying "already read", and the discarded response and unsent request leave the screen blank.
      if (ran.current === key) ran.current = null;
    };
  }, [api, loading, generation, path]);

  return (
    <>
      <Section id="tx-box" title="Transaction details">
        {error !== null ? (
          <SectionBody id="tx">
            <Banner>{error}</Banner>
          </SectionBody>
        ) : v === null ? (
          <SectionBody id="tx">
            <p className="clds-muted">Reading…</p>
          </SectionBody>
        ) : v.kind !== "transaction" ? (
          // Never skipped silently — the kind is named, and then "not in this version".
          <SectionBody id="tx">
            <DescriptionList variant="rows">
              <dt>Update ID</dt>
              <dd>
                <Chip value={v.updateId ?? ""} n={24} />
              </dd>
              <dt>Offset</dt>
              <dd className="clds-mono">{String(v.offset ?? "–")}</dd>
              <dt>Kind</dt>
              <dd>
                {v.kind}{" "}
                <Muted>
                  — not in this version.{" "}
                  {v.kind === "reassignment"
                    ? "A reassignment moves a contract between synchronizers; its count is on the contract page (reassignmentCounter)."
                    : "Only Daml transactions are shown."}
                </Muted>
              </dd>
            </DescriptionList>
          </SectionBody>
        ) : (
          <SectionBody id="tx">
            <Header v={v} />
          </SectionBody>
        )}
      </Section>
      {/* Keyed by the update — what a reader folded away on one transaction means nothing on the next. */}
      {v !== null && error === null && v.kind === "transaction" ? (
        <Events key={v.header.updateId} v={v} />
      ) : null}
    </>
  );
}

type Tx = Extract<TxResponse, { kind: "transaction" }>;

function Header({ v }: { v: Tx }) {
  const h = v.header;
  const witnessAll = Array.from(new Set(v.events.flatMap((e) => e.witnessParties ?? [])));
  return (
    <DescriptionList variant="rows">
      <dt>Update ID</dt>
      <dd>
        <Chip value={h.updateId} n={24} />
        {h.submittedByYou ? (
          <>
            {" "}
            <Badge>Submitted by you</Badge>
          </>
        ) : null}
      </dd>
      <dt>Offset</dt>
      <dd className="clds-mono">{h.offset}</dd>
      <dt>Effective at</dt>
      <dd className="clds-mono">
        {h.effectiveAt ?? "–"}
        {h.effectiveAt ? (
          <>
            {" "}
            <Muted>
              ({new Date(h.effectiveAt).toLocaleString("en-GB")} local · ledger effective time)
            </Muted>
          </>
        ) : null}
      </dd>
      <dt>Record time</dt>
      <dd className="clds-mono">
        {h.recordTime ?? "–"}{" "}
        <Muted>when the participant recorded it — not the same as effective time</Muted>
      </dd>
      <dt>Workflow ID</dt>
      <dd className="clds-mono">
        {h.workflowId ? <Chip value={h.workflowId} n={24} /> : <Muted>none</Muted>}
      </dd>
      <dt>Synchronizer</dt>
      <dd>
        {h.synchronizerId ? (
          <Chip value={h.synchronizerId} n={16} />
        ) : (
          <Muted>not in this response</Muted>
        )}
      </dd>
      {h.externalTransactionHash ? (
        <>
          <dt>External transaction hash</dt>
          <dd>
            <Chip value={h.externalTransactionHash} n={24} />{" "}
            <Muted>the signed hash — a different thing from the update ID</Muted>
          </dd>
        </>
      ) : null}
      <dt>Witness parties</dt>
      <dd>
        <PartyList values={witnessAll} />
      </dd>
      {/* "Why I can see this" — on which event one of my parties is caught, and in what standing.
          "Why can I not see it" is not answered. */}
      <dt>Visible to you because</dt>
      <dd>
        {v.visibility.status === "ok" ? (
          v.visibility.reasons.map((r, i) => (
            <span key={r.party}>
              {i > 0 ? "; " : ""}
              your party <PartyChip value={r.party} /> is{" "}
              {r.roles.map((x, k) => (
                <span key={x}>
                  {k > 0 ? " and " : ""}
                  <b>{x}</b>
                </span>
              ))}{" "}
              on event{r.eventIndexes.length === 1 ? "" : "s"} {r.eventIndexes.join(", ")}
            </span>
          ))
        ) : v.visibility.status === "no_own_parties" ? (
          // Reading as every party means holding none, so there is no party of yours to find on an event.
          <Muted>
            this account reads as every party and holds none of its own, so there is no role to
            report
          </Muted>
        ) : (
          <Muted>none of your parties appears on the events shown</Muted>
        )}{" "}
        <Muted>
          — this line only ever explains what you can see; what you cannot see is not known to
          exist.
        </Muted>
      </dd>
    </DescriptionList>
  );
}

// Events — their own section, the full width of it. The events shown are against all my parties (no lens).
// A transaction is a tree, and the rows are drawn as one: the order is the node order the participant sent, and an
// event is indented under the exercise whose subtree it fell in (core's nestUpdateEvents did the placing).
function Events({ v }: { v: Tx }) {
  const n = v.events.length;
  const nested = v.events.some((e) => e.tree.depth > 0);
  // The events folded away, by index. Folding hides a subtree, never an event on its own — what is hidden is
  // always named on the row that hides it ("6 events under it, folded"), because a reader must not have to
  // guess that the list is short of something.
  const [folded, setFolded] = useState<ReadonlySet<number>>(() => new Set<number>());
  // Which row the pointer is on. A row and the payload row under it are two <tr>s of one event, so the pair
  // is lit from here rather than by :hover, which would paint one half of it.
  const [hovered, setHovered] = useState<number | null>(null);
  // The party the lens is set to, if any. It **dims** rather than hides: an event the lens passes over is
  // still one of this transaction's events, and hiding it would break the tree above it as well.
  const [lens, setLens] = useState<string | null>(null);
  const { myParties } = useSession();

  // Every party named as a witness on the events shown, and how many of them name it. **witnessParties in
  // LEDGER_EFFECTS are cumulative informees** — the informees of that node and of every node above it — so
  // this counts where a party is entitled to see, not where it stands on the contract. And it is not "what
  // that party can see": it is what this reader can see with that party named on it.
  const informees = new Map<string, number>();
  for (const event of v.events)
    for (const party of event.witnessParties ?? [])
      informees.set(party, (informees.get(party) ?? 0) + 1);
  const parties = [...informees.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const lensCount = lens === null ? 0 : (informees.get(lens) ?? 0);
  // Of those, the ones it sees without standing on the contract — an informee of an event above it. Only a
  // create can answer that (divulgedTo in core), so this is a floor, never a total.
  const lensDivulged =
    lens === null ? 0 : v.events.filter((e) => (e.divulgedTo ?? []).includes(lens)).length;

  // Which cut the rows are read by. "tree" is the transaction as the node sent it; "views" cuts it where the
  // set of the reader's parties that received it changes. That is not Canton's view decomposition — Canton
  // cuts by participant, which this response cannot see; what this can claim is in groupUpdateViews (core) and
  // said under the table. The state keeps its old name; the screen does not.
  const [cut, setCut] = useState<"tree" | "views">("tree");
  const groups = groupUpdateViews(v.events);
  const groupOfEvent: number[] = [];
  groups.forEach((group, index) => {
    for (const event of group.eventIndexes) groupOfEvent[event] = index;
  });

  // Every capacity the reader's parties hold somewhere in a group, folded into one list.
  const standingIn = (group: UpdateViewGroup): string[] => [
    ...new Set(
      group.eventIndexes.flatMap((i) => (v.events[i]?.yours ?? []).flatMap((r) => r.roles)),
    ),
  ];

  const ancestorsOf = (i: number): number[] => {
    const chain: number[] = [];
    for (let at = v.events[i]?.tree.ancestorIndex ?? null; at !== null; )
      if (chain.includes(at)) break;
      else {
        chain.push(at);
        at = v.events[at]?.tree.ancestorIndex ?? null;
      }
    return chain;
  };
  const withChildren = v.events.flatMap((e, i) => (e.tree.descendantCount > 0 ? [i] : []));
  // **Only the row under the pointer.** It used to light its ancestors with it, which made sense while the
  // tree was drawn as rails — the light followed the line. With one-line rows and no rails, a row two places
  // up changing colour has nothing tying it to the pointer, and it reads as the table misfiring. Where an
  // event stands is said by the indent, and its details name the event it stands under.
  const lit = hovered === null ? [] : [hovered];
  const toggle = (i: number) =>
    setFolded((was) => {
      const next = new Set(was);
      if (!next.delete(i)) next.add(i);
      return next;
    });

  // What the table prints, in order: the events a fold has not hidden, and — under the views cut — a head
  // wherever the group changes. A group is a region of the tree, so the events in it need not be next to one
  // another; where one resumes after another the head says so rather than pretending it is a new one.
  type Row = { kind: "event" | "group"; at: number; group: number; again: boolean };
  const rows: Row[] = [];
  const opened = new Set<number>();
  let printing: number | null = null;
  v.events.forEach((_, i) => {
    if (ancestorsOf(i).some((a) => folded.has(a))) return;
    const group = groupOfEvent[i] ?? 0;
    if (cut === "views" && group !== printing) {
      rows.push({ kind: "group", at: i, group, again: opened.has(group) });
      opened.add(group);
      printing = group;
    }
    rows.push({ kind: "event", at: i, group, again: false });
  });

  return (
    <Section
      id="tx-events"
      title="Events"
      note={
        <>
          {/* Two choices, each of two: how the rows are cut, and how much of the tree is open. Each pair is
              one control, so the head reads as two questions rather than four words. The one in use is not
              disabled — a disabled control is drawn as the one you cannot have, and here it is the one you are
              looking at; aria-pressed says which. */}
          {n > 1 ? (
            <fieldset className="tx-seg" aria-label="Cut">
              <button
                type="button"
                className="tx-seg__opt"
                aria-pressed={cut === "tree"}
                onClick={() => setCut("tree")}
              >
                Tree
              </button>
              <button
                type="button"
                className="tx-seg__opt"
                aria-pressed={cut === "views"}
                onClick={() => setCut("views")}
              >
                Recipients
              </button>
            </fieldset>
          ) : null}
          {withChildren.length > 0 ? (
            <fieldset className="tx-seg" aria-label="Folding">
              <button
                type="button"
                className="tx-seg__opt"
                aria-pressed={folded.size === 0}
                onClick={() => setFolded(new Set<number>())}
              >
                Expand all
              </button>
              <button
                type="button"
                className="tx-seg__opt"
                aria-pressed={folded.size === withChildren.length}
                onClick={() => setFolded(new Set(withChildren))}
              >
                Roots only
              </button>
            </fieldset>
          ) : null}
          <span className="tx-head-count">{`${n} ${n === 1 ? "event" : "events"}`}</span>
        </>
      }
    >
      {n === 0 ? (
        <SectionBody>
          <Muted>No events to show</Muted>
        </SectionBody>
      ) : (
        <>
          {parties.length > 1 ? (
            <SectionBody className="tx-lens">
              <span className="clds-muted">Witness lens</span>
              {parties.map(([party, count]) => (
                <Button
                  key={party}
                  variant={lens === party ? "primary" : "outline"}
                  aria-pressed={lens === party}
                  title={myParties.includes(party) ? `${party} — one of your parties` : party}
                  onClick={() => setLens(lens === party ? null : party)}
                >
                  <span>{shortParty(party)}</span>
                  {myParties.includes(party) ? <span className="tx-lens__mine">you</span> : null}
                  <span className="tx-lens__count">{count}</span>
                </Button>
              ))}
              {/* What the lens does say, and what it does not. The events held here are the reader's own; a
                party named on them is entitled to those, and nothing follows about the rest of its ledger. */}
              {lens === null ? (
                <Muted>— dim every event the chosen party is not a witness of</Muted>
              ) : (
                <Muted>
                  — <b>{shortParty(lens)}</b> is a witness of {lensCount} of the {n} event
                  {n === 1 ? "" : "s"} you can see
                  {lensDivulged === 0
                    ? ""
                    : `, and on ${lensDivulged} of them it stands on nothing — it sees them through an event above (divulged)`}
                  . What it sees beyond them is not known here.
                </Muted>
              )}
            </SectionBody>
          ) : null}
          <Scroll>
            {/* Column widths are fixed — under auto layout the sum of the nowrap chips' minimum widths
              exceeds the section and the table breaks out of it sideways. */}
            <Table className="tx-events">
              <colgroup>
                <col style={{ width: ORDINAL_WIDTH }} />
                {/* The tree column: the caret, the indent, the kind badge and the count a fold hides. Wide
                  enough for all four at the first levels; deeper than that the badge clips, and the row's
                  details still name the kind in full. */}
                <col style={{ width: 290 }} />
                {/* Template takes what the others leave, because it is the one cell whose length varies. */}
                <col />
                <col style={{ width: 128 }} />
                <col style={{ width: 150 }} />
                {/* Where the reader stands. A column of its own, because "and me?" is asked down the table
                    rather than of one row at a time. */}
                <col style={{ width: 150 }} />
                {/* The chevron's column. Wide enough that the control sits in a column of its own rather than
                    against the table's edge. */}
                <col style={{ width: 56 }} />
              </colgroup>
              <tbody>
                <tr>
                  <th>#</th>
                  <th>Event</th>
                  <th>Template / choice</th>
                  <th>Contract</th>
                  <th>Witnesses</th>
                  {/* Named for what the cell holds — a capacity — not for whose it is. "You" on its own read as
                      a question. */}
                  <th title="In what capacity your own party is on this event: signatory, observer, controller, or witness — divulged, when a create reached you without your standing on it.">
                    Your role
                  </th>
                  <th />
                </tr>
                {rows.map((row) =>
                  row.kind === "group" ? (
                    <ViewGroupRow
                      key={`group-${row.at}`}
                      group={groups[row.group] as UpdateViewGroup}
                      n={row.group + 1}
                      again={row.again}
                      standing={standingIn(groups[row.group] as UpdateViewGroup)}
                    />
                  ) : (
                    <EventRow
                      // An event's identity is its index (#) within the update — the screen writes that number too.
                      key={`event-${row.at}`}
                      e={v.events[row.at] as TxEvent}
                      i={row.at}
                      folded={folded.has(row.at)}
                      rails={railsOf(v.events, row.at)}
                      opens={
                        (v.events[row.at]?.tree.descendantCount ?? 0) > 0 && !folded.has(row.at)
                      }
                      lit={lit.includes(row.at)}
                      dim={
                        lens !== null && !(v.events[row.at]?.witnessParties ?? []).includes(lens)
                      }
                      onToggle={() => toggle(row.at)}
                      onHover={setHovered}
                    />
                  ),
                )}
              </tbody>
            </Table>
          </Scroll>
        </>
      )}
      {/* One line under the table, and the rest behind a fold. What the screen cannot claim still has to be
          said somewhere a reader can find it; it does not have to be said to every reader every time. */}
      {cut === "views" ? (
        <SectionBody>
          <Muted>
            Cut where the set of your parties that received it changes — each band is which of your
            parties received that part. Not Canton's view decomposition.
          </Muted>{" "}
          <Disclosure summary="why not" className="clds-disclosure-inline">
            <Muted>
              Canton cuts a transaction into views by the <i>participants</i> that host each node's
              informees: a node joins its parent's view when those participants are a subset of the
              view's, and a new view starts only when a new participant comes in. This response
              names parties, not participants, and only the parties you asked as. So a new party
              here may sit on a participant already receiving the view — one view to Canton, two
              groups here — and a party you do not hold never shows at all. These groups are neither
              a subset nor a superset of Canton's views; they answer one question exactly: who,
              among your parties, received each part.
            </Muted>
          </Disclosure>
        </SectionBody>
      ) : nested ? (
        <SectionBody>
          <Muted>
            Nodes you are not a witness of never arrive, so an event may stand under an ancestor
            further up than its own parent.
          </Muted>
        </SectionBody>
      ) : null}
    </Section>
  );
}

// The head of a group of events that went to the same parties of the reader's. It is not a view: Canton cuts
// by participant, which this response cannot see, so the band names a group and says who received it — see
// groupUpdateViews (core).
//
// A group is a region of the tree, not a run of rows, so it can resume after another group has been printed;
// the head says "again" rather than numbering the same region twice.
function ViewGroupRow({
  group,
  n,
  again,
  standing,
}: {
  group: UpdateViewGroup;
  n: number;
  again: boolean;
  // Every capacity the reader's parties hold somewhere in this group — "and me, in here?"
  standing: string[];
}) {
  const count = group.eventIndexes.length;
  // The band keeps the table's columns: what it is stands where the events stand, who received it under
  // Witnesses, where the reader stands under You. As one cell across the table it ignored every column the
  // rows below it were lined up on.
  return (
    <tr className="tx-view">
      <td />
      <td className="tx-cell">
        <div
          className="tx-view__title"
          style={{ paddingInlineStart: Math.min(group.depth, INDENT_LEVELS) * INDENT_STEP }}
        >
          <b>group {n}</b>
          {again ? <Muted>continued</Muted> : null}
          <Muted>
            {count} event{count === 1 ? "" : "s"}
          </Muted>
        </div>
      </td>
      <td className="tx-cell" colSpan={2} />
      <td className="tx-cell" title={group.witnesses.join("\n")}>
        {/* The same shape the rows use — first party and a count — so the band is two lines like them, not a
            stack of chips. The column head already says these are the witnesses; the full list is the title. */}
        {group.witnesses.length === 0 ? (
          <Muted>none</Muted>
        ) : (
          <>
            <PartyChip value={group.witnesses[0] ?? ""} />
            {group.witnesses.length > 1 ? <Muted> +{group.witnesses.length - 1}</Muted> : null}
          </>
        )}
      </td>
      <td className="tx-cell">
        {standing.length === 0 ? null : (
          <span className="tx-standing">
            {standing.map((role) => (
              <Badge key={role} tone="accent" shape="rounded" className="tx-you">
                {role}
              </Badge>
            ))}
          </span>
        )}
      </td>
      <td />
    </tr>
  );
}

// **Where the reader stands on this event.** The capacities are core's (explainVisibility), asked per party
// and shown folded, because what a row has space for is "signatory", not "your party bob::… is a signatory".
// The parties are in the title.
//
// `witness` on a created event is divulgence — a Create's informees are exactly its stakeholders — and the
// row says that word instead. On an exercised event the same cannot be told (divulgedTo is null there), so
// the capacity is left as it is.
function YourStanding({ e }: { e: TxEvent }) {
  const yours = e.yours ?? [];
  if (yours.length === 0) return <Muted>—</Muted>;
  const roles = [...new Set(yours.flatMap((r) => r.roles))];
  const divulged = (e.divulgedTo ?? []).some((party) => yours.some((r) => r.party === party));
  return (
    <span
      className="tx-standing"
      title={yours.map((r) => `${r.party} — ${r.roles.join(", ")}`).join("\n")}
    >
      {roles.map((role) => (
        <Badge key={role} tone="accent" shape="rounded" className="tx-you">
          {role === "witness" && divulged ? "divulged" : role}
        </Badge>
      ))}
    </span>
  );
}

// One event = **one row**, and a second row under it only while its details are open. Every cell holds a
// single line: the tree lives in the first cell (the caret and the indent), the rest are short values, and
// what cannot be said in a line — the package, the node's place, the whole witness list, the arguments —
// waits behind the chevron at the end. The rows were blocks before, and a tree of blocks is not a tree you
// can follow; this is the shape a nested data table takes (Cloudscape's table with nested resources).
//
// The indent is capped: past this many levels the badge would be pushed out of its column, and the details
// name the place exactly, so nothing is lost by stopping the stagger.
const INDENT_LEVELS = 6;
const INDENT_STEP = 26;
// Where a rail is drawn inside its level: under the middle of that level's caret, so a child hangs from the
// control that revealed it. The caret is 24px wide and first in its line, hence 12; the cell's own padding is
// added in CSS (calc), so the token stays the one source of that number.
const RAIL_CENTRE = 12;
const railLeft = (level: number, fromTableEdge: boolean): string =>
  `calc(var(--clds-space-8) + ${(fromTableEdge ? ORDINAL_WIDTH : 0) + level * INDENT_STEP + RAIL_CENTRE}px)`;
// The ordinal column's width, which is also where the tree column's cells begin. The payload row spans the
// whole table, so its rails are placed from the table's edge and have to skip that column to line up.
const ORDINAL_WIDTH = 36;

// One entry per level between this event and the root, outermost first: true where that ancestor still has
// events below this row, which is the line that has to carry on past it. A subtree is contiguous in
// pre-order, so the ancestor at index `a` carries on past row `i` exactly when `a + descendantCount > i`.
function railsOf(events: readonly TxEvent[], i: number): boolean[] {
  const rails: boolean[] = [];
  const row = events[i];
  if (row === undefined) return rails;
  for (let at = row.tree.ancestorIndex; at !== null; ) {
    const ancestor = events[at];
    if (ancestor === undefined) break;
    rails.unshift(at + ancestor.tree.descendantCount > i);
    at = ancestor.tree.ancestorIndex;
  }
  return rails.slice(0, INDENT_LEVELS);
}

function EventRow({
  e,
  i,
  folded,
  rails,
  opens,
  lit,
  dim,
  onToggle,
  onHover,
}: {
  e: TxEvent;
  i: number;
  // This event's own subtree is hidden.
  folded: boolean;
  // One per level above this row: whether that ancestor still has events below it.
  rails: boolean[];
  // This row has events of its own showing under it, so its line carries on downwards.
  opens: boolean;
  // The pointer is on this event or on something under it.
  lit: boolean;
  // The lens is set to a party this event does not name — it stays, quietly.
  dim: boolean;
  onToggle: () => void;
  onHover: (i: number | null) => void;
}) {
  const { depth, descendantCount } = e.tree;
  const [open, setOpen] = useState(false);
  // **Folding a subtree hides this row's own details too.** Open, they sit exactly where the subtree would,
  // and a reader folding the events away is left looking at a block that did not go anywhere, unable to tell
  // which of the two it is. The state is kept, so unfolding brings the details back as they were.
  const showDetails = open && !folded;
  const witnesses = e.witnessParties ?? [];
  const rowClass = (base: string) =>
    `${base}${lit ? ` ${base}--lit` : ""}${dim ? ` ${base}--dim` : ""}`;
  const hover = { onMouseEnter: () => onHover(i), onMouseLeave: () => onHover(null) };
  // The whole row opens its details. What the row carries that does something of its own — the fold caret,
  // a contract link, a Copy — keeps its own click; the row only answers for the space between them.
  const openOnRowClick = (event: MouseEvent<HTMLTableRowElement>) => {
    if ((event.target as HTMLElement).closest("a, button, input, [role='button']")) return;
    if ((globalThis.getSelection?.()?.toString() ?? "") !== "") return;
    setOpen(!showDetails);
  };
  return (
    <>
      <tr
        className={`${rowClass("tx-event")} tx-event--clickable${
          showDetails ? " tx-event--open" : ""
        }`}
        onClick={openOnRowClick}
        {...hover}
      >
        <td>
          <Mono className="clds-muted">{i}</Mono>
        </td>
        <td className="tx-cell tx-cell--tree">
          {/* The rails, drawn against the cell rather than inside the line, so they run its whole height and
              meet the ones on the row above and the row below. A row is joined to the one it hangs from by a
              line, not by the eye measuring an indent. */}
          {rails.flatMap((carriesOn, level) => {
            const left = railLeft(level, false);
            const last = level === rails.length - 1;
            // The connector into this row, and — where the parent has more children after it — the line that
            // carries on past it, drawn as its own full-height rail so it reaches the row's edge whatever the
            // row's height. (A pseudo-element hung off the elbow could only ever be as tall as the elbow.)
            const marks = [];
            if (last)
              marks.push(
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: the level is the name
                  key={`${level}-elbow`}
                  aria-hidden="true"
                  className="tx-rail tx-rail--elbow"
                  style={{ left }}
                />,
              );
            if (carriesOn)
              marks.push(
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: the level is the name
                  key={`${level}-line`}
                  aria-hidden="true"
                  className="tx-rail tx-rail--line"
                  style={{ left }}
                />,
              );
            return marks;
          })}
          {opens ? (
            <span
              aria-hidden="true"
              className="tx-rail tx-rail--down"
              style={{ left: railLeft(Math.min(depth, INDENT_LEVELS), false) }}
            />
          ) : null}
          <div
            className="tx-lead"
            style={{ paddingInlineStart: Math.min(depth, INDENT_LEVELS) * INDENT_STEP }}
          >
            {/* The caret and the kind are one piece and never break apart — a caret on its own line above the
                badge reads as a row of its own. Only the count of what is folded away may drop below them. */}
            <span className="tx-lead__kind">
              {descendantCount > 0 ? (
                <button
                  type="button"
                  className="tx-caret"
                  aria-expanded={!folded}
                  aria-label={`${folded ? "Show" : "Hide"} the ${descendantCount} event${
                    descendantCount === 1 ? "" : "s"
                  } under event ${i}`}
                  onClick={() => {
                    // The details sit where the events under this one would, so they close out of the way.
                    setOpen(false);
                    onToggle();
                  }}
                >
                  <span aria-hidden="true">{folded ? "▶" : "▼"}</span>
                </button>
              ) : (
                /* The width a caret would take, so every badge in the column starts on one line. */
                <span className="tx-caret tx-caret--none" aria-hidden="true" />
              )}
              {e.kind === "created" ? (
                <Badge tone="positive" shape="rounded" mono>
                  created
                </Badge>
              ) : (
                <Badge tone="negative" shape="rounded" mono>
                  exercised{e.consuming ? " · consuming" : ""}
                </Badge>
              )}
            </span>
            {folded ? (
              // Short, because it shares a fixed column with the indent and the badge — the whole of it is
              // in the title, and the row's details say it in words.
              <Muted
                className="tx-folded"
                title={`${descendantCount} event${descendantCount === 1 ? "" : "s"} folded away under this one`}
              >
                +{descendantCount}
              </Muted>
            ) : null}
          </div>
        </td>
        <td className="tx-cell" title={e.choice ? `${e.templateId} · ${e.choice}` : e.templateId}>
          <b>{e.entity}</b> <Muted>{e.module}</Muted>
          {e.choice ? (
            <>
              {" · "}
              <Mono>{e.choice}</Mono>
            </>
          ) : null}
        </td>
        <td className="tx-cell">
          {e.kind === "created" ? (
            <ContractLink id={e.contractId} n={10} />
          ) : (
            <Chip value={e.contractId} n={10} />
          )}
        </td>
        <td className="tx-cell">
          {witnesses.length === 0 ? (
            <Muted>none</Muted>
          ) : (
            <>
              <PartyChip value={witnesses[0] ?? ""} />
              {witnesses.length > 1 ? (
                <Muted title={witnesses.join(", ")}> +{witnesses.length - 1}</Muted>
              ) : null}
            </>
          )}
        </td>
        <td className="tx-cell">
          <YourStanding e={e} />
        </td>
        <td className="tx-cell tx-cell--end">
          <button
            type="button"
            className="tx-caret tx-caret--more"
            aria-expanded={showDetails}
            aria-label={`${showDetails ? "Hide" : "Show"} the details of event ${i}`}
            onClick={() => setOpen(!showDetails)}
          >
            <span aria-hidden="true">{showDetails ? "▾" : "▸"}</span>
          </button>
        </td>
      </tr>
      {showDetails ? (
        <tr className={rowClass("tx-args")} {...hover}>
          <td
            className="tx-cell--tree"
            colSpan={7}
            // The payload stands one level in from its row, past every rail that crosses it — the same place
            // the row's children start — so the lines run beside it rather than through its first letters.
            style={{
              paddingInlineStart: `calc(var(--clds-space-8) + ${
                ORDINAL_WIDTH + (Math.min(depth, INDENT_LEVELS) + 1) * INDENT_STEP
              }px)`,
            }}
          >
            {/* The payload row stands between an event and the events under it, so the lines cross it. The
                connector's level carries on only where the parent has more children after this one, and the
                row's own level carries on when it has children of its own showing. */}
            {[
              ...rails.slice(0, -1),
              ...(rails.length > 0 ? [rails[rails.length - 1] === true] : []),
            ]
              .concat(opens ? [true] : [])
              .map((carriesOn, level) =>
                carriesOn ? (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: the level is the name
                    key={level}
                    aria-hidden="true"
                    className="tx-rail tx-rail--line"
                    style={{ left: railLeft(level, true) }}
                  />
                ) : null,
              )}
            <EventDetail e={e} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

// Everything about one event that does not fit on its line. Nothing here is new to the response — it is what
// the row used to carry in three stacked lines per cell.
function EventDetail({ e }: { e: TxEvent }) {
  const { nodeId, tree } = e;
  return (
    <div className="tx-detail">
      <DescriptionList variant="rows">
        <dt>Place</dt>
        <dd>
          <span className="clds-mono">
            {nodeId === null ? "node id not in this response" : `node ${nodeId}`}
          </span>
          {tree.ancestorIndex === null ? null : <> · under event {tree.ancestorIndex}</>}
          {tree.descendantCount === 0 ? null : (
            <>
              {" "}
              · {tree.descendantCount} event{tree.descendantCount === 1 ? "" : "s"} under it
            </>
          )}
        </dd>
        <dt>Package</dt>
        <dd className="clds-mono">{e.packageName ?? short(e.package, 12)}</dd>
        {e.kind === "exercised" ? (
          <>
            <dt>Acting parties</dt>
            <dd>
              <PartyList values={e.actingParties ?? []} />
            </dd>
          </>
        ) : (
          <>
            <dt>Signatories</dt>
            <dd>
              <PartyList values={e.signatories ?? []} />
            </dd>
            <dt>Observers</dt>
            <dd>
              <PartyList values={e.observers ?? []} />
            </dd>
          </>
        )}
        <dt>Witnesses</dt>
        <dd>
          <PartyList values={e.witnessParties ?? []} />{" "}
          <Muted>— informees of this event or of one above it</Muted>
        </dd>
        {/* Divulgence, where it can be told: a Create's informees are exactly its stakeholders, so a witness
            beyond them is one the subtree opened for. An Exercise cannot be told apart from this response. */}
        {e.kind === "created" ? (
          (e.divulgedTo ?? []).length > 0 ? (
            <>
              <dt>Divulged to</dt>
              <dd>
                <PartyList values={e.divulgedTo ?? []} />{" "}
                <Muted>
                  — no stakeholder of this contract; it sees the create through an event above it,
                  and a divulged contract can be read but never spent
                </Muted>
              </dd>
            </>
          ) : null
        ) : (
          <>
            <dt>Divulged to</dt>
            <dd>
              <Muted>
                not answered for an exercise — the response carries its acting parties, not the
                target contract's signatories or the choice's observers, so who stands on it cannot
                be told
              </Muted>
            </dd>
          </>
        )}
        {e.kind === "exercised" && e.consuming ? (
          <>
            <dt>Contract</dt>
            <dd>
              <Muted>
                archived by this exercise — an archived contract is not in this view, so there is no
                detail page to open
              </Muted>
            </dd>
          </>
        ) : null}
      </DescriptionList>
      {e.kind === "exercised" && e.choiceSchema ? (
        <div className="clds-muted">
          {e.choiceSchema.consuming ? "consuming" : "non-consuming"} · argument{" "}
          {e.choiceSchema.argType ? <Mono>{e.choiceSchema.argType}</Mono> : <NoType />}
          {(e.choiceSchema.argFields ?? []).length > 0
            ? `: ${(e.choiceSchema.argFields ?? []).map((f) => `${f.name}: ${f.type}`).join(", ")}`
            : ""}{" "}
          · returns{" "}
          {e.choiceSchema.returnType ? <Mono>{e.choiceSchema.returnType}</Mono> : <NoType />}
        </div>
      ) : null}
      {e.kind === "created" && e.templateSchema?.typedPayload ? (
        <Disclosure
          open
          summary={
            <>
              create argument <Muted>(typed)</Muted>
            </>
          }
        >
          <TypedFields fields={e.templateSchema.typedPayload} />
        </Disclosure>
      ) : null}
      <RawJson
        label={e.kind === "created" ? "create argument (raw)" : "choice argument"}
        value={e.kind === "created" ? e.createArgument : e.choiceArgument}
      />
      {e.kind === "exercised" ? <RawJson label="exercise result" value={e.exerciseResult} /> : null}
      {e.schemaStatus && e.schemaStatus !== "ok" ? (
        <div className="clds-muted" title={e.schemaStatus}>
          schema: {saidSchema(e.schemaStatus)}
        </div>
      ) : null}
    </div>
  );
}
