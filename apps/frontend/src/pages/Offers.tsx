// Offers are split by direction — "my turn" and "waiting on the counterparty" are different questions.
// The direction is exactly as the server judged it; what happens here is arrangement.
import { Badge, MessageRow, Mono, Muted, Scroll, Section, Table } from "@canton-lens/design-system";
import type { TransferOfferRow } from "../api/types.ts";
import { PartyChip } from "../format/chips.tsx";
import { text, trimZeros } from "../format/format.ts";
import { useSession } from "../session/SessionContext.tsx";

// Only turns the direction name the server judged into human words. `unknown` is not a failure but "no
// viewer party was passed", and then it says so — it does not stamp it "received" or "sent". Stamping
// what is unknown is wrong half the time.
function Direction({ d }: { d: string | undefined }) {
  switch (d) {
    case "received":
      return (
        <Badge tone="accent" strong>
          Received
        </Badge>
      );
    case "sent":
      return <Badge strong>Sent</Badge>;
    case "internal":
      return <Badge strong>Between my parties</Badge>;
    case "third_party":
      return <Badge strong>Third party</Badge>;
    case "unknown":
      return <Muted>direction not asked</Muted>;
    default:
      return <>{String(d)}</>;
  }
}

const Head = () => (
  <tr>
    <th>Direction</th>
    <th>Amount</th>
    <th>Counterparty</th>
    <th>Expiry</th>
  </tr>
);

function OfferRow({ r }: { r: TransferOfferRow }) {
  const direction = r.directionInfo?.direction;
  const other = direction === "received" ? r.sender : r.receiver;
  return (
    <tr>
      <td>
        <Direction d={direction} />
      </td>
      <td>
        <Mono title={String(r.amount ?? "")}>
          <b>{trimZeros(r.amount)}</b>
        </Mono>{" "}
        <Muted>{text(r.instrumentId)}</Muted>
      </td>
      <td>
        <PartyChip value={other} />
      </td>
      <td>
        {r.expiry.passed ? (
          <span className="expired">Expired ({Math.round(r.expiry.passedByMs / 60000)}m ago)</span>
        ) : (
          `${Math.round((r.expiry.remainingMs ?? 0) / 60000)}m left`
        )}
      </td>
    </tr>
  );
}

export function Offers() {
  const { offers: o } = useSession();
  if (!o) return <div id="view-offers" />;
  if (o.kind !== "available") {
    return (
      <div id="view-offers">
        <Section
          id="offers-in-box"
          title="Awaiting my action"
          subtitle="received"
          note="closest expiry first"
        >
          <Scroll>
            <Table id="offers-in">
              <tbody>
                <MessageRow tone="problem">Could not fetch: {o.reason ?? ""}</MessageRow>
              </tbody>
            </Table>
          </Scroll>
        </Section>
      </div>
    );
  }
  const view = o.view;
  // What expires soonest has to be seen first, so they are lined up by time left. This is arrangement,
  // not judgement.
  // What has passed sinks to the back but is not removed.
  const rows = (view.rows ?? []).slice().sort((a, b) => {
    if (a.expiry.passed !== b.expiry.passed) return a.expiry.passed ? 1 : -1;
    if (a.expiry.passed && b.expiry.passed) return a.expiry.passedByMs - b.expiry.passedByMs;
    if (!a.expiry.passed && !b.expiry.passed) return a.expiry.remainingMs - b.expiry.remainingMs;
    return 0;
  });
  const expired = rows.filter((r) => r.expiry.passed).length;
  // **Arranged** into three blocks (the server has already judged): my turn (received — internal belongs
  // here too, since one of my parties is the receiving side), waiting on the counterparty (sent), and
  // the rest (third party · direction unknown).
  const dirOf = (r: TransferOfferRow) => r.directionInfo?.direction;
  const inRows = rows.filter((r) => dirOf(r) === "received" || dirOf(r) === "internal");
  const outRows = rows.filter((r) => dirOf(r) === "sent");
  const otherRows = rows.filter(
    (r) => dirOf(r) !== "received" && dirOf(r) !== "internal" && dirOf(r) !== "sent",
  );
  const problems = view.problems ?? [];
  const table = (list: TransferOfferRow[], empty: string) =>
    list.length === 0 ? (
      <MessageRow>{empty}</MessageRow>
    ) : (
      <>
        <Head />
        {list.map((r) => (
          <OfferRow key={r.contractId} r={r} />
        ))}
      </>
    );

  return (
    <div id="view-offers">
      <Section
        id="offers-in-box"
        title="Awaiting my action"
        subtitle="received"
        note={
          <>
            {rows.length} {rows.length === 1 ? "offer" : "offers"} in total
            {expired > 0 ? ` · ${expired} expired` : ""} · closest expiry first
          </>
        }
      >
        <Scroll>
          <Table id="offers-in">
            <tbody>
              {table(inRows, "No offers are waiting on you")}
              {problems.length > 0 ? (
                <MessageRow tone="problem">
                  {problems.length} view errors — errors, not values
                </MessageRow>
              ) : null}
            </tbody>
          </Table>
        </Scroll>
      </Section>
      <Section
        id="offers-out-box"
        title="Waiting on the counterparty"
        subtitle="sent"
        note="they have not accepted yet"
        foot="Expired offers sink to the bottom but are not hidden"
      >
        <Scroll>
          <Table id="offers-out">
            <tbody>{table(outRows, "Nothing you sent is pending")}</tbody>
          </Table>
        </Scroll>
      </Section>
      {/* "The rest" opens a section only when there is something — a permanently empty section is
          noise, not information. */}
      {otherRows.length > 0 ? (
        <Section id="offers-other-box" title="Other visible offers">
          <Scroll>
            <Table id="offers-other">
              <tbody>{table(otherRows, "")}</tbody>
            </Table>
          </Scroll>
        </Section>
      ) : null}
    </div>
  );
}
