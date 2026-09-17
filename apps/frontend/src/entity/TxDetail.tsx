// **Transaction detail** — a **point lookup** (LEDGER_EFFECTS). It opens even outside the list's
// window as long as the participant keeps it; a pruned past the server names pruned. Arguments are Raw
// JSON from here on — the decoder is "more human words", not a precondition for showing them. The
// signed hash is not shown merged with the update id (it gets its own row).
import {
  Badge,
  Banner,
  DescriptionList,
  Disclosure,
  Mono,
  Muted,
  Scroll,
  Section,
  SectionBody,
  Table,
} from "@canton-lens/design-system";
import { useEffect, useRef, useState } from "react";
import { messageOf } from "../api/client.ts";
import { saidSchema } from "../api/said.ts";
import type { TxEvent, TxResponse } from "../api/types.ts";
import { Chip, ContractLink, PartyChip, PartyList } from "../format/chips.tsx";
import { short } from "../format/format.ts";
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
      {v !== null && error === null && v.kind === "transaction" ? <Events v={v} /> : null}
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
  return (
    <Section id="tx-events" title="Events" note={`${n} ${n === 1 ? "event" : "events"}`}>
      {n === 0 ? (
        <SectionBody>
          <Muted>No events to show</Muted>
        </SectionBody>
      ) : (
        <Scroll>
          {/* Column widths are fixed — under auto layout the sum of the nowrap chips' minimum widths
              exceeds the section and the table breaks out of it sideways. */}
          <Table className="tx-events">
            <colgroup>
              <col style={{ width: 44 }} />
              <col style={{ width: 196 }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: "20%" }} />
              <col />
            </colgroup>
            <tbody>
              <tr>
                <th>#</th>
                <th>Event</th>
                <th>Template / choice</th>
                <th>Contract</th>
                <th>Witnesses</th>
              </tr>
              {v.events.map((e, i) => (
                // An event's identity is its index (#) within the update — the screen writes that number too.
                // biome-ignore lint/suspicious/noArrayIndexKey: the index is the name
                <EventRow key={i} e={e} i={i} rails={railsOf(v.events, i)} />
              ))}
            </tbody>
          </Table>
        </Scroll>
      )}
      {nested ? (
        <SectionBody>
          <Muted>
            Indented by the transaction's node ids — an event stands under the exercise whose
            subtree it fell in. Nodes you are not an informee on never arrive, so an event may stand
            under an ancestor further up than its own parent; the row says which node it is and
            which event it stands under.
          </Muted>
        </SectionBody>
      ) : null}
    </Section>
  );
}

// One event = two rows. The upper row has five cells (index · kind · template/choice · contract ·
// witnesses), the lower row carries the arguments at full width.
// The arguments (typed fields · Raw JSON) take their width from their content, and as a sixth column
// they pushed the table out of its section.
//
// The rails are capped: past this many levels the rows would be pushed out of their column, and the line
// under the badge (node · under #) names the place exactly, so nothing is lost by stopping the stagger.
const INDENT_LEVELS = 6;

// The rails to draw to the left of one event, outermost first. A rail is `true` where the ancestor at that
// level still has events below this row — that is the line that has to carry on past it — and the last entry
// is the connector into this row itself.
//
// A subtree is contiguous in this list (pre-order), so the ancestor at index `a` owns rows `a+1 … a+n`: it
// continues below row `i` exactly when `a + n > i`. No second pass over the events is needed for that.
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

function EventRow({ e, i, rails }: { e: TxEvent; i: number; rails: boolean[] }) {
  const { ancestorIndex, descendantCount } = e.tree;
  const hasArgs =
    (e.kind === "created" && (e.templateSchema?.typedPayload || e.createArgument != null)) ||
    (e.kind === "exercised" &&
      (e.choiceSchema || e.choiceArgument != null || e.exerciseResult != null)) ||
    (e.schemaStatus && e.schemaStatus !== "ok");
  return (
    <>
      <tr className={hasArgs ? "tx-event tx-event--open" : "tx-event"}>
        <td>
          <Mono className="clds-muted">{i}</Mono>
        </td>
        <td>
          {/* The rails are drawn, not written: a line per level that carries on past this row, and a
              connector into the row itself — the shape a reader already knows from a file tree. */}
          <div className="tx-nest">
            {rails.map((carriesOn, level) => (
              <span
                // The level is the name — there is nothing else to identify a rail by.
                // biome-ignore lint/suspicious/noArrayIndexKey: the level is the name
                key={level}
                aria-hidden="true"
                className={`tx-nest__rail${
                  level === rails.length - 1
                    ? carriesOn
                      ? " tx-nest__rail--tee"
                      : " tx-nest__rail--elbow"
                    : carriesOn
                      ? " tx-nest__rail--line"
                      : ""
                }`}
              />
            ))}
            <div className="tx-nest__body">
              {e.kind === "created" ? (
                <Badge tone="positive" shape="rounded" mono>
                  created
                </Badge>
              ) : (
                <Badge tone="negative" shape="rounded" mono>
                  exercised{e.consuming ? " · consuming" : ""}
                </Badge>
              )}
              {/* Where this row sits in the tree, in words — the rails show it, this says it. */}
              {e.nodeId === null && ancestorIndex === null && descendantCount === 0 ? null : (
                <div className="clds-muted tx-nest__where">
                  {e.nodeId === null ? "node id not in this response" : `node ${e.nodeId}`}
                  {ancestorIndex === null ? null : ` · under #${ancestorIndex}`}
                  {descendantCount === 0
                    ? null
                    : ` · ${descendantCount} event${descendantCount === 1 ? "" : "s"} under it`}
                </div>
              )}
            </div>
          </div>
        </td>
        <td>
          <b>{e.entity}</b> <Muted>{e.module}</Muted>
          {e.choice ? (
            <>
              <br />
              <Mono>{e.choice}</Mono>
            </>
          ) : null}
          <br />
          <Mono className="clds-muted">{e.packageName ?? short(e.package, 8)}</Mono>
        </td>
        <td>
          {e.kind === "created" ? (
            <ContractLink id={e.contractId} n={12} />
          ) : (
            <>
              <Chip value={e.contractId} n={12} />
              {e.consuming ? (
                <>
                  {" "}
                  {/* The long form of this sat in a 20%-wide column and pushed the row three lines tall for
                      a sentence that says the same thing on every consuming event. */}
                  <Muted title="An archived contract is not in this view, so there is no detail page to open.">
                    archived by this
                  </Muted>
                </>
              ) : null}
            </>
          )}
        </td>
        <td>
          <PartyList values={e.witnessParties ?? []} />
          {e.actingParties ? (
            <div className="clds-muted">
              acting: <PartyList values={e.actingParties} />
            </div>
          ) : null}
        </td>
      </tr>
      {hasArgs ? (
        <tr className="tx-args">
          <td colSpan={5}>
            {/* The payload row carries the rails on past it — the line to an event's children has to cross
                its own arguments, or the tree breaks in two everywhere a payload is open. The gutter also
                sets the indent, so a nested exercise's arguments are never read as its parent's. */}
            <div className="tx-nest tx-nest--args">
              {[...rails, ...(descendantCount > 0 ? [true] : [])].map((carriesOn, level) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: the level is the name
                  key={level}
                  aria-hidden="true"
                  className={carriesOn ? "tx-nest__rail tx-nest__rail--line" : "tx-nest__rail"}
                />
              ))}
              <div className="tx-nest__body">
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
                {e.kind === "exercised" && e.choiceSchema ? (
                  <div className="clds-muted">
                    {e.choiceSchema.consuming ? "consuming" : "non-consuming"} · argument{" "}
                    {e.choiceSchema.argType ? <Mono>{e.choiceSchema.argType}</Mono> : <NoType />}
                    {(e.choiceSchema.argFields ?? []).length > 0
                      ? `: ${(e.choiceSchema.argFields ?? []).map((f) => `${f.name}: ${f.type}`).join(", ")}`
                      : ""}{" "}
                    · returns{" "}
                    {e.choiceSchema.returnType ? (
                      <Mono>{e.choiceSchema.returnType}</Mono>
                    ) : (
                      <NoType />
                    )}
                  </div>
                ) : null}
                <RawJson
                  label={e.kind === "created" ? "create argument (raw)" : "choice argument"}
                  value={e.kind === "created" ? e.createArgument : e.choiceArgument}
                />
                {e.kind === "exercised" ? (
                  <RawJson label="exercise result" value={e.exerciseResult} />
                ) : null}
                {e.schemaStatus && e.schemaStatus !== "ok" ? (
                  <div className="clds-muted" title={e.schemaStatus}>
                    schema: {saidSchema(e.schemaStatus)}
                  </div>
                ) : null}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
