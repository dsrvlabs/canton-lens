// **Home is a summary of my workspace at one offset.** The subject of the cards and the chart is not
// network statistics but **my own scope** — this explorer reads one participant's private ledger, so a
// number standing for "everything" does not exist in the first place.
// It is all one `/api/home` response; the server (core's buildHomeSummary) has finished judging and
// this screen only draws.
import {
  Badge,
  Banner,
  Card,
  CardGrid,
  CardUnavailable,
  Columns,
  ListCard,
  ListCardAmount,
  ListCardMeta,
  ListCardSub,
  MessageRow,
  Mono,
  Muted,
  Scroll,
  Section,
  Table,
} from "@canton-lens/design-system";
import { type PointerEvent, type ReactNode, useEffect, useState } from "react";
import { said } from "../api/said.ts";
import type { HomeOfferPreview, HomePendingOffersCard, HomeResponse } from "../api/types.ts";
import { PartyChip } from "../format/chips.tsx";
import { dur, fmtOffset, fmtTime, trimZeros, ts } from "../format/format.ts";
import { UpdateRows } from "../format/rows.tsx";
import { href } from "../route/hash.ts";
import { useSession } from "../session/SessionContext.tsx";

// Draws one card as "could not fetch" — it states the circumstance rather than 0. A failure drawn as 0
// is read as "there is none".
const Unavailable = ({ reason }: { reason: string | undefined }) => (
  <CardUnavailable>Could not fetch — {said(reason, "reason unknown")}</CardUnavailable>
);

export function Home() {
  const { home: h } = useSession();
  if (!h) return <div id="home" />;
  const when = fmtTime(h.readAt);

  if (h.cards.status === "no_party_rights") {
    // One line, not a board of empty numbers — the card row, the chart and the bottom two columns all
    // fold away and the circumstance is stated. 0 reads as "there is none", but the fact here is "no
    // rights to read", and those two must not be drawn the same way.
    return (
      <div id="home">
        <Banner id="no-party" style={{ marginTop: "var(--clds-space-8)" }}>
          This token carries no party rights — nothing on the ledger is visible to you. Ask whoever
          issued the token.
        </Banner>
      </div>
    );
  }
  const c = h.cards;
  // The "my parties" card — the number of parties on the token.
  const n = h.viewer?.partyCount ?? 0;
  // **The scope, not the count.** A super reader reads every party on the participant, so "the parties this
  // token reads the ledger as" is wrong about them whether they hold none of their own ("0 parties") or a
  // few ("1 party") — in both cases they read far more than the number shown.
  const readsAsAnyParty = h.viewer?.scope === "instance-wide";
  const o = c.pendingOffers;
  const t = c.tokens;
  const offerNotes: string[] = [];
  if (o.status === "ok") {
    if (o.imminent > 0)
      offerNotes.push(
        `${o.imminent} expire within 24h · soonest in ${dur(o.soonestRemainingMs ?? 0)}`,
      );
    else if (o.pending > 0) offerNotes.push(`soonest expires in ${dur(o.soonestRemainingMs ?? 0)}`);
    else offerNotes.push("nothing is waiting on you");
    if (o.expiredNotCounted > 0) offerNotes.push(`${o.expiredNotCounted} expired, not counted`);
    if (o.problems > 0) offerNotes.push(`${o.problems} view errors`);
  }

  return (
    <div id="home">
      <CardGrid id="home-cards">
        <Card
          id="end-card"
          label="Ledger end"
          valueClassName="clds-mono"
          valueTitle={String(h.offset)}
          value={<span id="end-offset">{fmtOffset(h.offset)}</span>}
          sub={
            <span id="end-note">
              {when
                ? `read at ${when} — every value on this screen is a snapshot at this offset`
                : "every value on this screen is a snapshot at this offset"}
            </span>
          }
        />
        <Card
          id="parties-card"
          href="#/parties"
          label="Parties"
          value={<span id="parties-count">{readsAsAnyParty ? "all" : n}</span>}
          unit={readsAsAnyParty || n !== 1 ? "parties" : "party"}
          sub={
            <span id="parties-note">
              {readsAsAnyParty
                ? n === 0
                  ? "this token reads as every party on the participant and holds none of its own"
                  : `this token reads as every party on the participant, and holds ${n} of its own`
                : "the parties this token reads the ledger as"}
            </span>
          }
        />
        {c.activeContracts.status === "ok" ? (
          <Card
            id="contracts-card"
            href="#/contracts"
            label="Active contracts"
            value={<span id="contracts-count">{fmtOffset(c.activeContracts.count)}</span>}
            sub={<span id="contracts-note">active contracts visible to you</span>}
          />
        ) : (
          <Card id="contracts-card" href="#/contracts" label="Active contracts">
            <Unavailable reason={c.activeContracts.reason} />
          </Card>
        )}
        {o.status === "ok" ? (
          <Card
            id="offers-card"
            href="#/offers"
            alert={o.imminent > 0}
            label="Pending offers"
            value={<span id="offers-count">{o.pending}</span>}
            unit="awaiting you"
            sub={<span id="offers-card-note">{offerNotes.join(" · ")}</span>}
          />
        ) : (
          <Card id="offers-card" href="#/offers" label="Pending offers">
            <Unavailable reason={o.reason} />
          </Card>
        )}
        {/* Kinds only. No amount total on home — an exact balance cannot be answered from a single
            source, so an amount on one card line risks lying. */}
        {t.status === "ok" ? (
          <Card
            id="tokens-card"
            href="#/holdings"
            label="My tokens"
            value={<span id="tokens-count">{t.kinds}</span>}
            unit={t.kinds === 1 ? "kind" : "kinds"}
            sub={
              <span id="tokens-note">
                {(t.labels ?? []).length > 0 ? t.labels.join(" · ") : "none visible to you"} ·
                standard Holding interface only — app tokens without it are not counted
                {t.problems > 0 ? ` · ${t.problems} view errors` : ""}
              </span>
            }
          />
        ) : (
          <Card id="tokens-card" href="#/holdings" label="My tokens">
            <Unavailable reason={t.reason} />
          </Card>
        )}
      </CardGrid>

      <Sparkline h={h} />

      {/* Bottom two columns — left the Pending offers stack (it stands in for a block explorer's
          Latest blocks), right Latest transactions */}
      <Columns id="home-bottom" ratio={[5, 7]}>
        <Section
          id="offers-stack"
          title="Pending offers"
          subtitle="awaiting you"
          note={
            <span id="stack-note">
              {o.status === "ok"
                ? `${o.pending} awaiting you` +
                  (o.imminent > 0 ? ` · ${o.imminent} within 24h` : "") +
                  ((o.preview ?? []).length < o.pending
                    ? ` · showing ${(o.preview ?? []).length}`
                    : "")
                : ""}
            </span>
          }
          foot={<a href="#/offers">View all offers</a>}
        >
          <div id="stack">
            <OfferStack o={o} />
          </div>
        </Section>

        {/* "Latest", not "all": the server also gives the window it searched (beginExclusive), and what
            lies outside it is not served. */}
        <Section
          id="updates-box"
          title="Latest transactions"
          note={<UpdatesNote h={h} />}
          foot={
            h.recent.status === "ok" ? (
              <span id="updates-window">
                <a href="#/transactions">View all transactions</a>{" "}
                <Muted>
                  · offsets ({h.recent.beginExclusive}, {h.offset}]
                </Muted>
              </span>
            ) : undefined
          }
        >
          <Scroll>
            <Table id="updates">
              <tbody>
                <LatestUpdates h={h} />
              </tbody>
            </Table>
          </Scroll>
        </Section>
      </Columns>
    </div>
  );
}

// **Sparkline** — draws the buckets the server divided as a smooth area chart.
// It is "the distribution of the last N updates (start–end)", not "daily volume" — the shape is
// familiar enough to be misread, so the footnote below names the subject.
function Sparkline({ h }: { h: HomeResponse }) {
  // Holds the draw-in effect back until **after the first paint**. A CSS animation starts the moment
  // its style is computed, so on a first visit where fonts and layout delay the first frame the chart
  // shows up already half drawn.
  // Two rAFs — the first is this frame's paint, the second the frame after — then the class goes on,
  // so it starts from 0%.
  // When the window changes (sp.from|to|count), from 0% again.
  const sp = h.sparkline;
  const drawKey = sp.status === "ok" ? `${sp.from}|${sp.to}|${sp.count}` : "";
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    setDrawn(false);
    if (!drawKey) return;
    let second = 0;
    const firstFrame = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setDrawn(true));
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(second);
    };
  }, [drawKey]);
  // The hovered bucket — the index of the nearest point. The value shows in the HTML overlay (guide,
  // dot, tip).
  const [hover, setHover] = useState<number | null>(null);
  const begin = h.recent.status === "ok" ? h.recent.beginExclusive : undefined;
  const window = `offsets (${begin ?? "?"}, ${h.offset}]`;
  let body: ReactNode;
  let note = "";
  let foot = "";
  if (sp.status === "ok") {
    const max = Math.max(1, ...sp.buckets);
    const n = sp.buckets.length;
    const W = 600;
    const H = 130; // matches the svg height in CSS (130px) — vertical is 1:1, so overlay px = viewBox units
    const TOP = 6; // keeps the line off the top edge
    const BASE = H - 1; // the floor where a count of 0 sits
    const step = n > 1 ? W / (n - 1) : W;
    const points = sp.buckets.map((count, i) => ({
      x: n > 1 ? i * step : W / 2,
      y: BASE - (count / max) * (BASE - TOP),
    }));
    const line = monotonePath(points);
    const first = points[0];
    const last = points[points.length - 1];
    const area =
      first && last ? `${line} L${last.x.toFixed(2)} ${BASE} L${first.x.toFixed(2)} ${BASE} Z` : "";
    // The time bucket i covers — retraces the server's equal-width split the same way (from–to into n).
    const fromMs = new Date(sp.from).getTime();
    const toMs = new Date(sp.to).getTime();
    const bucketSpan = (toMs - fromMs) / n;
    const rangeOf = (i: number) => {
      const a = new Date(fromMs + bucketSpan * i).toISOString();
      const b = new Date(fromMs + bucketSpan * (i + 1)).toISOString();
      const sameDay = a.slice(0, 10) === b.slice(0, 10);
      return `${ts(a)} – ${sameDay ? ts(b).slice(11) : ts(b)}`;
    };
    const pick = (e: PointerEvent<HTMLDivElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      if (r.width <= 0) return;
      const rel = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      setHover(n > 1 ? Math.round(rel * (n - 1)) : 0);
    };
    const hp = hover === null ? undefined : points[hover];
    const hc = hover === null ? undefined : sp.buckets[hover];
    // The tip sticks to the dot — above it by default, below when the dot sits high on the plot (a peak).
    // Edge buckets are pinned to one side so the tip does not leave the plot.
    const tipSide =
      hover === null ? "" : hover < n * 0.2 ? " tip--left" : hover > n * 0.8 ? " tip--right" : "";
    const tipBelow = hp !== undefined && hp.y < 56 ? " tip--below" : "";
    body = (
      <>
        {/* The plot that follows the pointer to show values — the values themselves are also in the svg's
            aria-label and in the footnote, so nothing is lost without a pointer. */}
        <div
          className="spark__plot"
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={() => setHover(null)}
        >
          <svg
            key={drawKey}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${sp.count} updates over time`}
          >
            <defs>
              <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopOpacity="0.35" />
                <stop offset="1" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <line x1="0" y1={BASE + 0.5} x2={W} y2={BASE + 0.5} />
            {/* Drawn left to right on entry (.spark .draw, styles.css). Line and area are one group so
                they open together. */}
            <g className={drawn ? "draw draw--in" : "draw"}>
              {area ? <path className="area" d={area} /> : null}
              <path className="line" d={line} vectorEffect="non-scaling-stroke" />
            </g>
          </svg>
          {/* Hover overlay — not drawn inside the svg because a viewBox stretched only horizontally
              (preserveAspectRatio none) turns the dot into an ellipse and squashes the text. The HTML
              is laid on with % across and px down (1:1 with the viewBox). */}
          {hp && hc !== undefined && hover !== null ? (
            <>
              <div
                className="spark__guide"
                style={{ left: `${(hp.x / W) * 100}%` }}
                aria-hidden="true"
              />
              <div
                className="spark__dot"
                style={{ left: `${(hp.x / W) * 100}%`, top: hp.y }}
                aria-hidden="true"
              />
              <div
                className={`spark__tip${tipSide}${tipBelow}`}
                style={{ left: `${(hp.x / W) * 100}%`, top: hp.y }}
                role="status"
              >
                <b>
                  {hc} {hc === 1 ? "update" : "updates"}
                </b>
                <Mono>{rangeOf(hover)}</Mono>
              </div>
            </>
          ) : null}
        </div>
        <div className="axis">
          <Mono>{ts(sp.from)}</Mono>
          <Mono>{ts(sp.to)}</Mono>
        </div>
      </>
    );
    note = `${sp.count} ${sp.count === 1 ? "update" : "updates"} visible to you`;
    foot = `Distribution of the last ${sp.count} updates by time, from ${ts(sp.from)} to ${ts(sp.to)} (${window}) — the span is whatever those offsets cover, not a fixed period.`;
  } else if (sp.status === "empty") {
    body = (
      <p className="clds-muted" style={{ margin: 0 }}>
        No transactions in this window
      </p>
    );
    foot = `${window} — nothing visible to you happened here. Older history is not in this view.`;
  } else {
    body = <Banner>Could not fetch — {said(sp.reason, "reason unknown")}</Banner>;
  }
  return (
    <Section
      id="spark-box"
      title="Activity"
      note={<span id="spark-note">{note}</span>}
      foot={<span id="spark-foot">{foot}</span>}
    >
      <div className="spark" id="spark">
        {body}
      </div>
    </Section>
  );
}

// Monotone cubic interpolation (Fritsch–Carlson) — smooth between points, never overshooting a value
// (it never digs below 0).
function monotonePath(points: { x: number; y: number }[]): string {
  const f = (v: number) => v.toFixed(2);
  const first = points[0];
  if (first === undefined) return "";
  if (points.length === 1) return `M0 ${f(first.y)} L600 ${f(first.y)}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) break;
    dx.push(b.x - a.x);
    slope.push((b.y - a.y) / (b.x - a.x));
  }
  const tangent: number[] = [slope[0] ?? 0];
  for (let i = 1; i < points.length - 1; i++) {
    const m0 = slope[i - 1] ?? 0;
    const m1 = slope[i] ?? 0;
    if (m0 * m1 <= 0) {
      tangent.push(0);
    } else {
      const w1 = 2 * (dx[i] ?? 0) + (dx[i - 1] ?? 0);
      const w2 = (dx[i] ?? 0) + 2 * (dx[i - 1] ?? 0);
      tangent.push((w1 + w2) / (w1 / m0 + w2 / m1));
    }
  }
  tangent.push(slope[slope.length - 1] ?? 0);
  let d = `M${f(first.x)} ${f(first.y)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const w = dx[i];
    if (!a || !b || w === undefined) break;
    const t0 = tangent[i] ?? 0;
    const t1 = tangent[i + 1] ?? 0;
    d += ` C${f(a.x + w / 3)} ${f(a.y + (t0 * w) / 3)} ${f(b.x - w / 3)} ${f(b.y - (t1 * w) / 3)} ${f(b.x)} ${f(b.y)}`;
  }
  return d;
}

// **Pending offers stack** — draws, card by card, the front of the set (preview) the server picked in
// order of nearest expiry.
// Direction, expiry and order are not judged again here. Clicking a card goes to that offer
// contract's detail.
function OfferStack({ o }: { o: HomePendingOffersCard }) {
  if (o.status !== "ok") {
    return (
      <Banner style={{ margin: "12px 18px 18px" }}>
        Could not fetch — {said(o.reason, "reason unknown")}
      </Banner>
    );
  }
  const cards = o.preview ?? [];
  if (cards.length === 0) {
    return (
      <p className="clds-muted" style={{ margin: "12px 18px 18px" }}>
        Nothing is waiting on you
        {o.expiredNotCounted > 0 ? ` — ${o.expiredNotCounted} expired, not counted` : ""}
      </p>
    );
  }
  return (
    <>
      {cards.map((c) => (
        <OfferCard key={c.contractId} c={c} />
      ))}
    </>
  );
}

function OfferCard({ c }: { c: HomeOfferPreview }) {
  return (
    // The card holds a party link, so it cannot be wrapped in an <a> (nested anchors) — the same
    // delegation as the table's RowLink (click and Enter).
    <ListCard
      alert={c.imminent}
      onActivate={() => {
        location.hash = href.contract(c.contractId);
      }}
    >
      <div>
        <ListCardAmount className="clds-mono" title={String(c.amount ?? "")}>
          {trimZeros(c.amount)}
        </ListCardAmount>{" "}
        <b>
          {typeof c.instrumentId === "string"
            ? c.instrumentId
            : JSON.stringify(c.instrumentId ?? "")}
        </b>{" "}
        {c.direction === "internal" ? (
          <Badge strong>Between my parties</Badge>
        ) : (
          <Badge tone="accent" strong>
            Received
          </Badge>
        )}
      </div>
      <ListCardSub>
        from <PartyChip value={c.sender} /> ·{" "}
        <ListCardMeta>expires in {dur(c.remainingMs)}</ListCardMeta>
      </ListCardSub>
    </ListCard>
  );
}

const HOME_ROWS = 6;
function UpdatesNote({ h }: { h: HomeResponse }) {
  if (h.recent.status !== "ok") return null;
  const rows = (h.recent.rows ?? []).slice(0, HOME_ROWS);
  const total = h.recent.totalInWindow ?? rows.length;
  return <>{total > rows.length ? `latest ${rows.length} of ${total}` : ""}</>;
}

// **Latest transactions** (bottom right of home) — only the most recent few. All of them are on the
// Transactions screen (View all).
function LatestUpdates({ h }: { h: HomeResponse }) {
  const recent = h.recent;
  if (recent.status !== "ok") {
    return (
      <MessageRow tone="problem">
        Could not fetch — {said(recent.reason, "reason unknown")}
      </MessageRow>
    );
  }
  const rows = (recent.rows ?? []).slice(0, HOME_ROWS);
  if (rows.length === 0) {
    return (
      <MessageRow>
        Nothing visible to you happened in this window — older history is not in this view
      </MessageRow>
    );
  }
  return <UpdateRows rows={rows} />;
}
