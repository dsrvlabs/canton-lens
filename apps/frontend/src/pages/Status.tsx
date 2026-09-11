import {
  Badge,
  Banner,
  DescriptionList,
  Disclosure,
  Mono,
  Muted,
  Section,
  SectionBody,
} from "@canton-lens/design-system";
import { said } from "../api/said.ts";
import type { NodeResponse } from "../api/types.ts";
import { Chip } from "../format/chips.tsx";
import { useSession } from "../session/SessionContext.tsx";

const timestamp = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 19);

export function Status() {
  return (
    <div id="view-status">
      <SessionStatus />
      <ParticipantStatus />
    </div>
  );
}

function SessionStatus() {
  const { session, loading } = useSession();
  const view = session?.outcome === "view" ? session : null;
  const token = session?.token;
  return (
    <Section id="session-box" title="Session" note="Current ledger identity">
      <SectionBody>
        {session === null ? (
          <Muted>{loading ? "Loading session…" : "Session information unavailable"}</Muted>
        ) : view === null ? (
          <Banner>
            {session.outcome === "unavailable" ? session.reason : "Session information unavailable"}
          </Banner>
        ) : (
          <DescriptionList variant="rows" className="status-fields">
            <dt>Ledger user ID</dt>
            <dd>
              <Chip value={view.userId} n={32} />
            </dd>
            <dt>Access scope</dt>
            <dd>
              <Badge>{view.scope === "own" ? "Assigned parties" : "Instance-wide"}</Badge>
            </dd>
            <dt>Assigned parties</dt>
            <dd>
              <a href="#/parties">
                {view.parties.length} {view.parties.length === 1 ? "party" : "parties"}
              </a>
            </dd>
            <dt>Explorer access</dt>
            <dd>
              <Badge>Read-only</Badge>
            </dd>
            <dt>Last checked</dt>
            <dd>
              <time dateTime={session.readAt}>{timestamp(session.readAt)} UTC</time>
            </dd>
          </DescriptionList>
        )}
        {token ? (
          <Disclosure summary="Ledger token details" className="session-token">
            <DescriptionList variant="rows" className="status-fields">
              <dt>Expires at</dt>
              <dd>
                {token.expiresAt ? (
                  <time dateTime={token.expiresAt}>{timestamp(token.expiresAt)} UTC</time>
                ) : (
                  <Muted>Not reported</Muted>
                )}
              </dd>
              <dt>Issuer</dt>
              <dd>
                {token.issuerHost ? <Mono>{token.issuerHost}</Mono> : <Muted>Not reported</Muted>}
              </dd>
              <dt>Audience</dt>
              <dd>
                {token.audience.length ? (
                  token.audience.map((a) => (
                    <div key={a}>
                      <Mono>{a}</Mono>
                    </div>
                  ))
                ) : (
                  <Muted>Not reported</Muted>
                )}
              </dd>
            </DescriptionList>
            <p className="clds-muted">
              Token details are from the last read. Token expiry is separate from your sign-in
              session.
            </p>
          </Disclosure>
        ) : null}
      </SectionBody>
    </Section>
  );
}

function progressLabel(n: NodeResponse): string {
  switch (n.progress.case) {
    case "advanced":
      return `Advanced by ${n.progress.delta} offsets`;
    case "stalled":
      return "No new updates since the previous check";
    case "regressed":
      return `Offset decreased by ${Math.abs(n.progress.delta)}`;
    case "prior-unavailable":
      return "Previous reading unavailable — refresh to compare";
    case "current-unavailable":
      return "Current reading unavailable";
    case "both-unavailable":
      return "Readings unavailable";
    default:
      return "Not available";
  }
}

function ParticipantStatus() {
  const { node, loading } = useSession();
  return (
    <Section id="node-box" title="Participant" note="Node connection and ledger progress">
      <SectionBody>
        {node === null ? (
          <Muted>{loading ? "Loading participant…" : "Participant information unavailable"}</Muted>
        ) : (
          <DescriptionList variant="rows" className="status-fields">
            <dt>Connection</dt>
            <dd>
              {node.version.status === "ok" ? (
                <Badge tone="positive">Connected</Badge>
              ) : (
                <>
                  <Badge tone="negative">Check failed</Badge>{" "}
                  <Muted>{said(node.version.reason, "Could not read participant version")}</Muted>
                </>
              )}
            </dd>
            <dt>Canton version</dt>
            <dd>
              {node.version.status === "ok" ? (
                <Mono>{node.version.version}</Mono>
              ) : (
                <Muted>Unavailable</Muted>
              )}
            </dd>
            <dt>Ledger end</dt>
            <dd>
              {node.ledgerEnd.status === "ok" ? (
                <Mono>{node.ledgerEnd.offset}</Mono>
              ) : (
                <Muted>{said(node.ledgerEnd.reason, "Unavailable")}</Muted>
              )}
            </dd>
            <dt>Ledger progress</dt>
            <dd>{progressLabel(node)}</dd>
            <dt>Last checked</dt>
            <dd>
              <time dateTime={node.readAt}>{timestamp(node.readAt)} UTC</time>
            </dd>
          </DescriptionList>
        )}
      </SectionBody>
    </Section>
  );
}
