import {
  Badge,
  Banner,
  MessageRow,
  Scroll,
  Section,
  SectionBody,
  Table,
} from "@canton-lens/design-system";
import type { SessionResponse } from "../api/types.ts";
import { PartyChip } from "../format/chips.tsx";
import { RawJson } from "../format/typed.tsx";
import { useSession } from "../session/SessionContext.tsx";

// **The drawing is split from the fetching.** Everything below `…View` is a function of one response and
// nothing else: no context, no effect, no clock. That is what lets a test hand it the answer a real
// participant gave and look at the rows that come out — with the two joined, a static render only ever
// reaches the "reading…" branch and the screen itself is never looked at (2026-09-18).
export function Parties() {
  const { session, loading } = useSession();
  return <PartiesView session={session ?? null} loading={loading} />;
}

export function PartiesView({
  session,
  loading,
}: {
  session: SessionResponse | null;
  loading: boolean;
}) {
  const view = session?.outcome === "view" ? session : null;
  return (
    <div id="view-parties">
      <Section
        id="parties-box"
        title="Parties"
        note="Party-specific rights assigned to your ledger user"
        foot="These are ledger permissions. This explorer is read-only."
      >
        {session?.outcome === "unavailable" ? (
          <SectionBody>
            <Banner>{session.reason}</Banner>
          </SectionBody>
        ) : (
          <Scroll>
            <Table id="parties-table">
              <thead>
                <tr>
                  <th scope="col">Party</th>
                  <th scope="col">Your permissions</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {view === null ? (
                  <MessageRow colSpan={3}>
                    {loading ? "Loading parties…" : "Party information unavailable"}
                  </MessageRow>
                ) : view.parties.length === 0 ? (
                  <MessageRow colSpan={3}>
                    {view.scope === "own"
                      ? "No party-specific rights assigned"
                      : "No party-specific rights assigned — this account reads as every party on the participant."}
                  </MessageRow>
                ) : (
                  [...view.parties]
                    .sort((a, b) => a.party.localeCompare(b.party))
                    .map((p) => (
                      <tr key={p.party}>
                        <td>
                          <PartyChip value={p.party} />
                        </td>
                        <td>
                          <div className="party-permissions">
                            {p.kinds.map((kind) => (
                              <Badge key={kind}>
                                {kind === "CanActAs" ? "Can act as" : "Can read as"}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td>
                          <RawJson label="Raw rights" value={p.rights} />
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </Table>
          </Scroll>
        )}
      </Section>
    </div>
  );
}
