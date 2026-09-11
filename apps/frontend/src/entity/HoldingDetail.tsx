// **Balance detail** — unfolds one balance contract by contract. amount and issuer are what the server
// adapter gave, and the created time comes from the contract detail route — the screen never parses a
// payload itself.
import {
  Badge,
  DescriptionList,
  Mono,
  Muted,
  Scroll,
  Section,
  SectionBody,
  Table,
} from "@canton-lens/design-system";
import { useEffect, useRef, useState } from "react";
import type { ContractResponse } from "../api/types.ts";
import { ContractLink, PartyChip } from "../format/chips.tsx";
import { trimZeros, ts } from "../format/format.ts";
import { useSession } from "../session/SessionContext.tsx";

export function HoldingDetail({
  owner,
  instrumentId,
  admin,
}: {
  owner: string;
  instrumentId: string;
  admin: string | null;
}) {
  const { api, loading, generation, holdingsCache } = useSession();
  const g = holdingsCache.groups.find(
    (x) =>
      x.owner === owner &&
      x.instrumentId === instrumentId &&
      (admin === null || (x.instrumentAdmin ?? null) === admin),
  );
  const contracts = g?.contracts ?? [];
  const [created, setCreated] = useState<Record<string, string>>({});

  // Created at — filled in by asking the contract detail per contract. A cell that failed says so.
  const ran = useRef<string | null>(null);
  useEffect(() => {
    if (loading) return;
    const key = `${generation}|${owner}|${instrumentId}|${admin ?? ""}`;
    if (ran.current === key) return;
    ran.current = key;
    let cancelled = false;
    setCreated({});
    const group = holdingsCache.groups.find(
      (x) =>
        x.owner === owner &&
        x.instrumentId === instrumentId &&
        (admin === null || (x.instrumentAdmin ?? null) === admin),
    );
    for (const c of group?.contracts ?? []) {
      api<ContractResponse>(`/api/contracts/${encodeURIComponent(c.contractId)}`).then(
        (v) => {
          if (!cancelled) setCreated((prev) => ({ ...prev, [c.contractId]: ts(v.createdAt) }));
        },
        () => {
          if (!cancelled) setCreated((prev) => ({ ...prev, [c.contractId]: "could not fetch" }));
        },
      );
    }
    return () => {
      cancelled = true;
      // An abandoned run clears its own marker (ran) — left behind, a re-entering run with the same key turns
      // back saying "already read", and the discarded response and unsent request leave the screen blank.
      if (ran.current === key) ran.current = null;
    };
  }, [api, loading, generation, holdingsCache, owner, instrumentId, admin]);

  return (
    <Section id="holding-box" title="Holding details">
      <SectionBody id="holding">
        {!g ? (
          <p className="clds-muted">
            This balance is not among the holdings this screen last read. Refresh, or it may be
            outside what you can see.
          </p>
        ) : (
          <DescriptionList variant="rows">
            <dt>Instrument</dt>
            <dd>
              <b>{g.instrumentId}</b>
            </dd>
            <dt>Owner</dt>
            <dd>
              <PartyChip value={g.owner} />
              {g.ownerIsViewer ? (
                <>
                  {" "}
                  <Badge>mine</Badge>
                </>
              ) : null}
            </dd>
            <dt>Balance</dt>
            <dd className="clds-mono" title={g.total}>
              <b>{trimZeros(g.total)}</b> {g.instrumentId}{" "}
              <Muted>— sum of the contracts below, visible to you</Muted>
            </dd>
            <dt>Made of</dt>
            <dd>
              <Scroll>
                <Table>
                  <tbody>
                    <tr>
                      <th>Contract</th>
                      <th>Amount</th>
                      <th>Issuer</th>
                      <th>Created</th>
                    </tr>
                    {contracts.map((c) => (
                      <tr key={c.contractId}>
                        <td>
                          <ContractLink id={c.contractId} />
                        </td>
                        <td className="clds-mono" title={c.amount}>
                          <b>{trimZeros(c.amount)}</b>
                        </td>
                        <td>
                          <PartyChip value={c.issuer} />
                        </td>
                        <td>
                          <Mono className="clds-muted">{created[c.contractId] ?? "…"}</Mono>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Scroll>
            </dd>
          </DescriptionList>
        )}
      </SectionBody>
    </Section>
  );
}
