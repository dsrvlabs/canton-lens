// The server unwraps buildContractDetail's result and hands it over flat — the view itself, not
// `{ok, view}`.
// **The structure block is the summary**: Package (name + hash behind a disclosure) · Module · Entity
// (→ catalog) · Signatories · Observers · Synchronizer · reassignmentCounter (Canton-specific — the
// number of reassignments) · created at · the creating update (point lookup by offset). No prose
// summary is made.
import {
  DescriptionList,
  Disclosure,
  Mono,
  Muted,
  Section,
  SectionBody,
} from "@canton-lens/design-system";
import { useEffect, useRef, useState } from "react";
import { messageOf } from "../api/client.ts";
import { said } from "../api/said.ts";
import type { ContractResponse } from "../api/types.ts";
import { Chip, PartyChip, PartyList } from "../format/chips.tsx";
import { fmtOffset } from "../format/format.ts";
import { Choices, TypedFields } from "../format/typed.tsx";
import { href } from "../route/hash.ts";
import { useSession } from "../session/SessionContext.tsx";

export function ContractDetail({ contractId }: { contractId: string }) {
  const { api, loading, generation, fail } = useSession();
  const [v, setV] = useState<ContractResponse | null>(null);

  const ran = useRef<string | null>(null);
  useEffect(() => {
    if (loading) return;
    const key = `${generation}|${contractId}`;
    if (ran.current === key) return;
    ran.current = key;
    let cancelled = false;
    setV(null);
    api<ContractResponse>(`/api/contracts/${encodeURIComponent(contractId)}`).then(
      (res) => {
        if (!cancelled) setV(res);
      },
      (e: unknown) => {
        // Opened by address but absent or not visible to you — said in a banner, not an empty screen.
        if (!cancelled) fail(messageOf(e));
      },
    );
    return () => {
      cancelled = true;
      // An abandoned run clears its own marker (ran) — left behind, a re-entering run with the same key turns
      // back saying "already read", and the discarded response and unsent request leave the screen blank.
      if (ran.current === key) ran.current = null;
    };
  }, [api, loading, generation, contractId, fail]);

  if (v === null) return null;

  // "Not in this version" and "could not fetch" are said apart — the first is structurally absent, the
  // second is an accident. Drawn as the same blank, a user reads the accident as a fact.
  const absent = (slot: ContractResponse["choices"]) =>
    slot.kind === "not_in_this_version"
      ? "Not in this version — structurally absent from the layer-1 response"
      : `Could not fetch: ${slot.reason ?? "reason unknown"}`;
  const sc = v.schema;
  const rawPayload = v.createArgument ? (
    <pre className="clds-mono clds-scroll">{JSON.stringify(v.createArgument, null, 1)}</pre>
  ) : (
    <Muted>none</Muted>
  );

  return (
    <Section id="detail-box" title="Contract details">
      <SectionBody id="detail">
        <DescriptionList variant="rows">
          <dt>Contract ID</dt>
          <dd>
            <Chip value={contractId} n={16} />
          </dd>
          <dt>Package</dt>
          <dd>
            <b>{v.packageName}</b>{" "}
            <Disclosure summary="hash" className="clds-disclosure-inline">
              <Chip value={v.packageId} n={20} />
            </Disclosure>{" "}
            {sc.status === "ok" && sc.packageVersion ? (
              <Muted>— version {sc.packageVersion} (from the package on the participant)</Muted>
            ) : (
              <Muted>— version is not in this layer</Muted>
            )}
          </dd>
          <dt>Module</dt>
          <dd className="clds-mono">{v.module}</dd>
          <dt>Entity</dt>
          <dd>
            <a className="clds-mono" href={href.contractsOfTemplate(v.module, v.entity)}>
              {v.entity}
            </a>{" "}
            <Muted>— all your contracts of this template</Muted>
          </dd>
          <dt>Signatories</dt>
          <dd>
            <PartyList values={v.signatories} />
          </dd>
          <dt>Observers</dt>
          <dd>
            <PartyList values={v.observers} />
          </dd>
          <dt>Synchronizer</dt>
          <dd>
            {v.synchronizerId ? (
              <Chip value={v.synchronizerId} n={16} />
            ) : (
              <Muted>not in this response</Muted>
            )}
          </dd>
          <dt>Reassignments</dt>
          <dd className="clds-mono">
            {v.reassignmentCounter ?? "–"}{" "}
            <Muted>times this contract moved between synchronizers (reassignmentCounter)</Muted>
          </dd>
          <dt>Created at</dt>
          <dd className="clds-mono">{v.createdAt}</dd>
          <dt>Created in</dt>
          <dd>
            {v.createdAtOffset !== null && v.createdAtOffset !== undefined ? (
              <>
                <a className="clds-mono" href={href.txByOffset(v.createdAtOffset)}>
                  update at offset {fmtOffset(v.createdAtOffset)}
                </a>{" "}
                <Muted>
                  — looked up on the participant; if it has been pruned, that page says so
                </Muted>
              </>
            ) : (
              <Muted>offset not in this response</Muted>
            )}
          </dd>
          <dt>Contract key</dt>
          <dd className="clds-muted">
            {v.contractKey?.kind === "present" ? (
              <pre className="clds-mono clds-scroll">
                {JSON.stringify(v.contractKey.value, null, 1)}
              </pre>
            ) : (
              "none — Daml 3 contracts have no keys"
            )}
          </dd>
          {/* "Why I can see this" — the standing the server (explainVisibility) judged across all my
              parties. "Why can I not see it" is not answered. */}
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
                  ))}
                </span>
              ))
            ) : v.visibility.status === "no_party_found" ? (
              <Muted>none of your parties is a signatory or observer here</Muted>
            ) : v.visibility.status === "no_own_parties" ? (
              // A super reader reads as every party and holds none, so there is no "your parties" to
              // report a role for. Saying "none of your parties is a signatory" would read as an absence
              // that was checked for.
              <Muted>
                this account reads as every party and holds none of its own, so there is no role to
                report
              </Muted>
            ) : (
              <Muted>not determined</Muted>
            )}{" "}
            <Muted>
              — this line only ever explains what you can see; what you cannot see is not known to
              exist.
            </Muted>
          </dd>
          {sc.status === "ok" && (sc.implements ?? []).length > 0 ? (
            <>
              <dt>Implements</dt>
              <dd>
                {sc.implements.map((i, k) => (
                  <span key={`${i.module}:${i.name}`}>
                    {k > 0 ? " · " : ""}
                    <Mono>
                      {i.module}:{i.name}
                    </Mono>
                    {i.packageId ? (
                      <>
                        {" "}
                        <Muted>@{i.packageId.slice(0, 8)}</Muted>
                      </>
                    ) : null}
                  </span>
                ))}
              </dd>
            </>
          ) : null}
          {/* Payload — with the schema read, **typed label-value pairs** (reading a contract's
              blueprint, landing point 1); without it, Raw JSON plus a one-line reason.
              generic is not a failure but the default mode — no badge for it. Raw JSON always stays,
              behind a disclosure. */}
          <dt>Payload</dt>
          <dd>
            {sc.status === "ok" && Array.isArray(sc.typedPayload) ? (
              <>
                <TypedFields fields={sc.typedPayload} />
                <Disclosure summary="Raw JSON" style={{ marginTop: 6 }}>
                  {rawPayload}
                </Disclosure>
              </>
            ) : (
              <>
                {rawPayload}
                <p className="clds-muted" style={{ margin: "6px 0 0" }}>
                  Typed view unavailable —{" "}
                  {said(sc.status === "ok" ? undefined : sc.reason, "no schema")}. The package
                  schema (Daml-LF) could not be read for this template.
                </p>
              </>
            )}
          </dd>
          <dt>Choices</dt>
          <dd>
            {sc.status === "ok" ? (
              <>
                <Choices choices={sc.choices} />
                <p className="clds-muted" style={{ margin: "6px 0 0" }}>
                  Definitions read from the package on the participant (Daml-LF {sc.lfVersion ?? ""}
                  ). Read-only — this explorer never exercises a choice.
                </p>
              </>
            ) : (
              <Muted>
                {absent(v.choices)} — the package schema could not be read (
                {said(sc.reason, "no schema")})
              </Muted>
            )}
          </dd>
          <dt>Related contracts</dt>
          <dd className="clds-muted">
            {absent(v.relatedContracts)} — no definition of "related" yet
          </dd>
          <dt>History</dt>
          <dd className="clds-muted">{absent(v.history)} — not in this view</dd>
        </DescriptionList>
      </SectionBody>
    </Section>
  );
}
