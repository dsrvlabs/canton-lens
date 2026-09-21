// **Incoming transfer preapprovals** — drawn exactly as the server (core's buildTransferPreapprovals)
// read and expiry-judged them. A preapproval the receiver set up in advance means the sender can
// transfer straight away, with no offer-accept round trip.
import { Badge, MessageRow, Scroll, Section, Table } from "@canton-lens/design-system";
import type { PreapprovalsResponse, TransferPreapprovalRow } from "../api/types.ts";
import { ContractLink, PartyChip } from "../format/chips.tsx";
import { useSession } from "../session/SessionContext.tsx";

export const preapprovalLeft = (r: TransferPreapprovalRow) =>
  r.expiry.passed ? (
    <span className="expired">Expired ({Math.round(r.expiry.passedByMs / 60000)}m ago)</span>
  ) : (
    `${Math.round((r.expiry.remainingMs ?? 0) / 60000)}m left`
  );

// **The drawing is split from the fetching.** Everything below `…View` is a function of one response and
// nothing else: no context, no effect, no clock. That is what lets a test hand it the answer a real
// participant gave and look at the rows that come out — with the two joined, a static render only ever
// reaches the "reading…" branch and the screen itself is never looked at (2026-09-18).
export function Preapprovals() {
  const { preapprovals } = useSession();
  return <PreapprovalsView p={preapprovals ?? null} />;
}

export function PreapprovalsView({ p }: { p: PreapprovalsResponse | null }) {
  if (!p) return <div id="view-preapprovals" />;
  const rows = p.kind === "available" ? (p.view.rows ?? []) : [];
  const problems = p.kind === "available" ? (p.view.problems ?? []) : [];
  return (
    <div id="view-preapprovals">
      <Section
        id="preapprovals-box"
        title="Transfer preapprovals"
        note={<>receivers who accept without an offer round-trip</>}
        foot="A preapproval means the receiver has approved incoming transfers of that instrument in advance — a sender who can see it may transfer directly."
      >
        <Scroll>
          <Table id="preapprovals">
            <tbody>
              {p.kind !== "available" ? (
                <MessageRow tone="problem">Could not fetch: {p.reason ?? ""}</MessageRow>
              ) : rows.length === 0 ? (
                <MessageRow>No preapprovals are visible to you</MessageRow>
              ) : (
                <>
                  <tr>
                    <th>Receiver</th>
                    <th>Instrument</th>
                    <th>Issuer</th>
                    <th>Expiry</th>
                    <th>Contract</th>
                  </tr>
                  {rows.map((r) => (
                    <tr key={r.contractId}>
                      <td>
                        <PartyChip value={r.receiver} />
                        {r.receiverIsViewer ? (
                          <>
                            {" "}
                            <Badge>mine</Badge>
                          </>
                        ) : null}
                      </td>
                      <td>
                        <b>{r.instrumentId}</b>
                      </td>
                      <td>
                        <PartyChip value={r.issuer} />
                      </td>
                      <td>{preapprovalLeft(r)}</td>
                      <td>
                        <ContractLink id={r.contractId} n={6} />
                      </td>
                    </tr>
                  ))}
                </>
              )}
              {problems.length > 0 ? (
                <MessageRow tone="problem" colSpan={5}>
                  {problems.length} preapproval contracts had an unexpected shape — not guessed
                </MessageRow>
              ) : null}
            </tbody>
          </Table>
        </Scroll>
      </Section>
    </div>
  );
}
