// **Holdings** — drawn exactly as the server (core's buildTokenHoldings) parsed and summed the Holding
// payloads. It shows how many contracts a balance is made of and their ids too — with only the sum
// there is no way down to the individual contracts.
// There is no "all holders" or total supply column — the visibility model cannot produce those numbers.
// A balance I cannot see cannot enter the sum, and a total written anyway is the sum of my own view
// while it reads as the whole.
import {
  Badge,
  GroupRow,
  MessageRow,
  Mono,
  Muted,
  Scroll,
  Section,
  Table,
} from "@canton-lens/design-system";
import type { TokenHoldingGroup } from "../api/types.ts";
import { PartyChip, RowLink } from "../format/chips.tsx";
import { trimZeros } from "../format/format.ts";
import { href } from "../route/hash.ts";
import { useSession } from "../session/SessionContext.tsx";

export function Holdings() {
  const { holdings: h } = useSession();
  if (!h) return <div id="view-holdings" />;
  const groups = h.kind === "available" ? (h.view.groups ?? []) : [];
  const problems = h.kind === "available" ? (h.view.problems ?? []) : [];
  // The party is the outer group — tokens are a story about ownership, so "who" comes first. The server
  // has already sorted (mine first), so here we only gather consecutive owners under one heading.
  let prevOwner: string | null = null;
  return (
    <div id="view-holdings">
      <Section
        id="holdings-box"
        title="Holdings"
        note={
          h.kind === "available"
            ? `token balances visible to you · standard Holding interface only`
            : "token balances visible to you"
        }
        foot="A balance is the sum of the Holding contracts visible to you — like UTXOs, one balance is made of several contracts. It is not the token's total supply."
      >
        <Scroll>
          <Table id="holdings">
            <tbody>
              {h.kind !== "available" ? (
                <MessageRow tone="problem">Could not fetch: {h.reason ?? ""}</MessageRow>
              ) : groups.length === 0 ? (
                <MessageRow>
                  No standard Holding contracts are visible to you — app tokens that do not
                  implement the standard interface are not counted
                </MessageRow>
              ) : (
                <>
                  <tr>
                    <th>Instrument</th>
                    <th>Balance</th>
                    <th>Made of</th>
                  </tr>
                  {groups.map((g) => {
                    const head = g.owner !== prevOwner;
                    prevOwner = g.owner;
                    const to = href.holding(g);
                    return <GroupRows key={to} head={head} to={to} g={g} />;
                  })}
                </>
              )}
              {problems.length > 0 ? (
                <MessageRow tone="problem" colSpan={3}>
                  {problems.length} Holding contracts had an unexpected shape — excluded from the
                  sums above, not guessed
                </MessageRow>
              ) : null}
            </tbody>
          </Table>
        </Scroll>
      </Section>
    </div>
  );
}

function GroupRows({ head, to, g }: { head: boolean; to: string; g: TokenHoldingGroup }) {
  return (
    <>
      {head ? (
        <GroupRow>
          <td colSpan={3}>
            <PartyChip value={g.owner} />
            {g.ownerIsViewer ? (
              <>
                {" "}
                <Badge>mine</Badge>
              </>
            ) : null}
          </td>
        </GroupRow>
      ) : null}
      {/* Clicking a balance row goes to that balance's detail (#/holding/…). */}
      <RowLink to={to}>
        <td>
          <a href={to}>
            <b>{g.instrumentId}</b>
          </a>
        </td>
        <td>
          <Mono title={g.total}>
            <b>{trimZeros(g.total)}</b>
          </Mono>
          {g.exactBalance === "unavailable_decay" ? (
            <>
              {" "}
              <Muted>face value — exact balance unavailable, this token decays per round</Muted>
            </>
          ) : null}
        </td>
        <td>
          <Muted>
            made of {g.contractCount} {g.contractCount === 1 ? "contract" : "contracts"}
          </Muted>
          {g.instrumentAdmin ? (
            <Muted>
              {" "}
              · issued by <PartyChip value={g.instrumentAdmin} />
            </Muted>
          ) : null}
        </td>
      </RowLink>
    </>
  );
}
