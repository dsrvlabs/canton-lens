// **Transaction detail** — a **point lookup** (LEDGER_EFFECTS). It opens even outside the list's
// window as long as the participant keeps it; a pruned past the server names pruned. Arguments are Raw
// JSON from here on — the decoder is "more human words", not a precondition for showing them. The
// signed hash is not shown merged with the update id (it gets its own row).
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

  // Every party named as an informee on the events shown, and how many of them name it. This is not "what
  // that party can see" — it is what this reader can see with that party named on it.
  const informees = new Map<string, number>();
  for (const event of v.events)
    for (const party of event.witnessParties ?? [])
      informees.set(party, (informees.get(party) ?? 0) + 1);
  const parties = [...informees.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const lensCount = lens === null ? 0 : (informees.get(lens) ?? 0);

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

  return (
    <Section
      id="tx-events"
      title="Events"
      note={
        <>
          {withChildren.length > 0 ? (
            <>
              <Button
                variant="plain"
                onClick={() => setFolded(new Set<number>())}
                disabled={folded.size === 0}
              >
                Expand all
              </Button>{" "}
              <Button
                variant="plain"
                onClick={() => setFolded(new Set(withChildren))}
                disabled={folded.size === withChildren.length}
              >
                Roots only
              </Button>{" "}
              ·{" "}
            </>
          ) : null}
          {`${n} ${n === 1 ? "event" : "events"}`}
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
              <span className="clds-muted">Informee lens</span>
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
                party named on them is an informee on those, and nothing follows about the rest of its ledger. */}
              {lens === null ? (
                <Muted>— dim every event the chosen party is not an informee on</Muted>
              ) : (
                <Muted>
                  — <b>{shortParty(lens)}</b> is an informee on {lensCount} of the {n} event
                  {n === 1 ? "" : "s"} you can see. What it sees beyond them is not known here.
                </Muted>
              )}
            </SectionBody>
          ) : null}
          <Scroll>
            {/* Column widths are fixed — under auto layout the sum of the nowrap chips' minimum widths
              exceeds the section and the table breaks out of it sideways. */}
            <Table className="tx-events">
              <colgroup>
                <col style={{ width: 44 }} />
                {/* The tree column: the caret, the indent and the kind badge. Wide enough for all three at
                  the first levels; deeper than that the badge clips, and the row's details still name the
                  kind in full. */}
                <col style={{ width: 300 }} />
                <col style={{ width: "24%" }} />
                <col style={{ width: "16%" }} />
                <col />
                <col style={{ width: 44 }} />
              </colgroup>
              <tbody>
                <tr>
                  <th>#</th>
                  <th>Event</th>
                  <th>Template / choice</th>
                  <th>Contract</th>
                  <th>Witnesses</th>
                  <th />
                </tr>
                {v.events.map((e, i) =>
                  ancestorsOf(i).some((a) => folded.has(a)) ? null : (
                    <EventRow
                      // An event's identity is its index (#) within the update — the screen writes that number too.
                      // biome-ignore lint/suspicious/noArrayIndexKey: the index is the name
                      key={i}
                      e={e}
                      i={i}
                      folded={folded.has(i)}
                      lit={lit.includes(i)}
                      dim={lens !== null && !(e.witnessParties ?? []).includes(lens)}
                      onToggle={() => toggle(i)}
                      onHover={setHovered}
                    />
                  ),
                )}
              </tbody>
            </Table>
          </Scroll>
        </>
      )}
      {nested ? (
        <SectionBody>
          <Muted>
            Indented by the transaction's node ids — an event stands under the exercise whose
            subtree it fell in. Nodes you are not an informee on never arrive, so an event may stand
            under an ancestor further up than its own parent; the row's details say which node it is
            and which event it stands under. Folding an exercise hides its subtree and nothing else
            — the row that hides it counts what went with it.
          </Muted>
        </SectionBody>
      ) : null}
    </Section>
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

function EventRow({
  e,
  i,
  folded,
  lit,
  dim,
  onToggle,
  onHover,
}: {
  e: TxEvent;
  i: number;
  // This event's own subtree is hidden.
  folded: boolean;
  // The pointer is on this event or on something under it.
  lit: boolean;
  // The lens is set to a party this event does not name — it stays, quietly.
  dim: boolean;
  onToggle: () => void;
  onHover: (i: number | null) => void;
}) {
  const { depth, descendantCount } = e.tree;
  const [open, setOpen] = useState(false);
  const witnesses = e.witnessParties ?? [];
  const rowClass = (base: string) =>
    `${base}${lit ? ` ${base}--lit` : ""}${dim ? ` ${base}--dim` : ""}`;
  const hover = { onMouseEnter: () => onHover(i), onMouseLeave: () => onHover(null) };
  // The whole row opens its details. What the row carries that does something of its own — the fold caret,
  // a contract link, a Copy — keeps its own click; the row only answers for the space between them.
  const openOnRowClick = (event: MouseEvent<HTMLTableRowElement>) => {
    if ((event.target as HTMLElement).closest("a, button, input, [role='button']")) return;
    if ((globalThis.getSelection?.()?.toString() ?? "") !== "") return;
    setOpen(!open);
  };
  return (
    <>
      <tr
        className={`${rowClass("tx-event")} tx-event--clickable${open ? " tx-event--open" : ""}`}
        onClick={openOnRowClick}
        {...hover}
      >
        <td>
          <Mono className="clds-muted">{i}</Mono>
        </td>
        <td className="tx-cell">
          <div
            className="tx-lead"
            style={{ paddingInlineStart: Math.min(depth, INDENT_LEVELS) * INDENT_STEP }}
          >
            {descendantCount > 0 ? (
              <button
                type="button"
                className="tx-caret"
                aria-expanded={!folded}
                aria-label={`${folded ? "Show" : "Hide"} the ${descendantCount} event${
                  descendantCount === 1 ? "" : "s"
                } under event ${i}`}
                onClick={onToggle}
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
        <td className="tx-cell tx-cell--end">
          <button
            type="button"
            className="tx-caret tx-caret--more"
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} the details of event ${i}`}
            onClick={() => setOpen(!open)}
          >
            <span aria-hidden="true">{open ? "▾" : "▸"}</span>
          </button>
        </td>
      </tr>
      {open ? (
        <tr className={rowClass("tx-args")} {...hover}>
          <td colSpan={6}>
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
          <PartyList values={e.witnessParties ?? []} />
        </dd>
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
