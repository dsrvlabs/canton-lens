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
function Events({ v }: { v: Tx }) {
  const n = v.events.length;
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
              <col style={{ width: 168 }} />
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
                <EventRow key={i} e={e} i={i} />
              ))}
            </tbody>
          </Table>
        </Scroll>
      )}
    </Section>
  );
}

// One event = two rows. The upper row has five cells (index · kind · template/choice · contract ·
// witnesses), the lower row carries the arguments at full width.
// The arguments (typed fields · Raw JSON) take their width from their content, and as a sixth column
// they pushed the table out of its section.
function EventRow({ e, i }: { e: TxEvent; i: number }) {
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
          {e.kind === "created" ? (
            <Badge tone="positive" shape="rounded" mono>
              created
            </Badge>
          ) : (
            <Badge tone="negative" shape="rounded" mono>
              exercised{e.consuming ? " · consuming" : ""}
            </Badge>
          )}
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
                  <Muted>
                    archived by this — no detail page; archived contracts are not in this view
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
                {e.choiceSchema.returnType ? <Mono>{e.choiceSchema.returnType}</Mono> : <NoType />}
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
          </td>
        </tr>
      ) : null}
    </>
  );
}
