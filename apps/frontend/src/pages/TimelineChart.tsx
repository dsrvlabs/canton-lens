// **The lifetime bar chart.** The Timeline screen and the Timeline tab of the party page use the same
// chart — a rule fixed on only one side would make the same chart say different things in two places.
//
// **No counting here** — what started and ended when, and which group it belongs to, is judged by the
// server (core's buildLifelines and groupLifelines, /api/timeline). What lives here is position and
// colour, and the legend that writes down what the chart cannot say.
import { Faint, Muted, Scroll } from "@canton-lens/design-system";
import { useState } from "react";
import type { Lifeline, LifelineGroup } from "../api/types.ts";
import { fmtOffset, short, shortParty, ts } from "../format/format.ts";
import { href } from "../route/hash.ts";

// Position inside the window — a percentage. Where a bar sits is **screen arithmetic**, so it lives
// here and not on the server (what started and ended when is the server's judgement: core's
// buildLifelines).
// If the window's width is 0 (an empty ledger, one and the same point) the division does not hold, so
// the bar takes the whole track. A contract that appeared and vanished at one point must show too, so
// the width has a floor, and the left edge steps back from the right wall by that much.
const MIN_WIDTH = 0.6;
export function place(
  line: Lifeline,
  window: { from: number; to: number },
): { left: number; width: number } {
  const span = window.to - window.from;
  // When the window is a single point (from == to) there is no width to divide by. Every bar on that
  // screen is at that one point, so it fills the track — hair-thin bars crowded at the left edge read
  // as "almost nothing".
  if (span <= 0) return { left: 0, width: 100 };
  const left = Math.min(Math.max(((line.start - window.from) / span) * 100, 0), 100 - MIN_WIDTH);
  const width = Math.min(Math.max(((line.end - line.start) / span) * 100, MIN_WIDTH), 100 - left);
  return { left, width };
}

// The cap on bars drawn. Past it, both the number drawn and the total are written — never cut silently.
const MAX_BARS = 300;
const TICKS = 5;

// Grouping and order arrive decided by the server (core's groupLifelines) — the screen draws in that order.
export function LifelineChart({
  groups,
  total,
  window,
}: {
  groups: readonly LifelineGroup[];
  total: number;
  window: { from: number; to: number };
}) {
  // The cap fills from the top rather than cutting whole groups away — a half group reads as "this
  // template has only this many".
  const drawn: LifelineGroup[] = [];
  let budget = MAX_BARS;
  for (const g of groups) {
    if (budget <= 0) break;
    drawn.push(g.lines.length <= budget ? g : { ...g, lines: g.lines.slice(0, budget) });
    budget -= g.lines.length;
  }
  const shownCount = drawn.reduce((n, g) => n + g.lines.length, 0);
  return (
    <>
      <Scroll>
        <div className="tl">
          <Axis window={window} />
          {drawn.map((g) => (
            <div className="tl__group" key={g.key}>
              <div className="tl__group-head">
                <b>{g.entity}</b> <Muted>{g.module}</Muted>{" "}
                <Faint>
                  {g.lines.length} {g.lines.length === 1 ? "contract" : "contracts"}
                </Faint>
              </div>
              {g.lines.map((line) => (
                <Row key={line.contractId} line={line} window={window} />
              ))}
            </div>
          ))}
        </div>
      </Scroll>
      <div className="tl__legend">
        <span className="tl__key tl__key--alive" /> still alive
        <span className="tl__key tl__key--archived" /> archived in this window
        <span className="tl__key tl__key--unknown" /> end unknown — an archive by a counterparty
        carries no parties, so it can fall outside a filtered window
        {shownCount < total ? (
          <Faint>
            {" "}
            · drawing {shownCount} of {total}
          </Faint>
        ) : null}
      </div>
    </>
  );
}

// Ticks — offsets dividing the window. Offsets and not timestamps because the gap in time between two
// updates is uneven: with time as the axis, a stretch where nothing happened eats the whole screen.
//
// **The width decides how many.** Always driving in five would write the same number twice in a window
// of width 3 — 50·51·51·52·52 — because offsets are integers and there is no room for a tick between
// them. So the step is taken as an integer, and the last mark is always the end point.
function Axis({ window }: { window: { from: number; to: number } }) {
  const span = window.to - window.from;
  const step = Math.max(1, Math.ceil(span / (TICKS - 1)));
  const marks: number[] = [];
  for (let at = window.from; at < window.to; at += step) marks.push(at);
  marks.push(window.to);
  return (
    <div className="tl__row tl__row--axis">
      <div className="tl__label" />
      <div className="tl__track tl__track--axis">
        {marks.map((at, i) => (
          <span
            className="tl__tick"
            key={at}
            style={{ left: span <= 0 ? "0%" : `${((at - window.from) / span) * 100}%` }}
            data-edge={i === 0 ? "start" : i === marks.length - 1 ? "end" : undefined}
          >
            {fmtOffset(at)}
          </span>
        ))}
      </div>
    </div>
  );
}

// The party cell — **a click only copies.** A link would fling you off to the party page in the middle
// of reading the chart, and a dropdown is not worth a third click target on a 10px row.
//
// What is written is one name plus the count of the rest, but **what is copied is all of them** (whole
// ids, not the shortened form). Joined with commas because this screen's Parties field takes a
// comma-separated list — what you copied is the next question.
function PartyCopy({ parties }: { parties: readonly string[] }) {
  const [copied, setCopied] = useState(false);
  const first = parties[0] ?? "";
  return (
    <button
      type="button"
      className="tl__parties"
      title={`${parties.join("\n")}\n\nClick to copy ${parties.length === 1 ? "this id" : `all ${parties.length} ids`}`}
      onClick={() => {
        void navigator.clipboard.writeText(parties.join(", ")).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 900);
        });
      }}
    >
      {copied ? "Copied" : shortParty(first)}
      {parties.length > 1 ? <Faint> +{parties.length - 1}</Faint> : null}
    </button>
  );
}

// One bar, one row. A click goes **to the contract for what is still there** and **to the update that
// ended it** for what is gone — an archived contract has no detail page (it is read from the ACS, so a
// click would only 404).
function Row({ line, window }: { line: Lifeline; window: { from: number; to: number } }) {
  const { left, width } = place(line, window);
  const to =
    line.state === "archived" && line.archivedBy !== null
      ? href.tx(line.archivedBy)
      : line.state === "alive"
        ? href.contract(line.contractId)
        : null;
  const title = [
    `${line.entity} · ${line.contractId}`,
    line.startKnown
      ? `created at offset ${fmtOffset(line.start)}`
      : `created before this window (offset ${fmtOffset(window.from)} or earlier)`,
    line.state === "archived"
      ? `archived at offset ${fmtOffset(line.end)}`
      : line.state === "alive"
        ? "still active"
        : "end unknown — no archive seen in this window and it is not in the current contracts",
    line.createdAt === null ? null : ts(line.createdAt),
  ]
    .filter(Boolean)
    .join("\n");
  const bar = (
    <span
      className={`tl__bar tl__bar--${line.state}${line.startKnown ? "" : " tl__bar--open-left"}`}
      style={{ left: `${left}%`, width: `${width}%` }}
    />
  );
  return (
    <div className="tl__row">
      <div className="tl__label">
        {to === null ? (
          <span className="clds-mono" title={line.contractId}>
            {short(line.contractId, 8)}
          </span>
        ) : (
          <a className="clds-mono" href={to} title={line.contractId}>
            {short(line.contractId, 8)}
          </a>
        )}{" "}
        {/* Whose contract it is. **There is no guarantee of one name** — there can be several
          signatories, and observers attach too. So only the first plus the count of the rest is
          written, and all of them go in the title. A contract seen only as an archive is empty,
          because the ledger gives no parties there (it does not bear false witness). */}
        {line.parties.length === 0 ? (
          <Faint title="the archive event carries no signatories or observers">–</Faint>
        ) : (
          <PartyCopy parties={line.parties} />
        )}
      </div>
      <div className="tl__track" title={title}>
        {to === null ? bar : <a href={to}>{bar}</a>}
      </div>
    </div>
  );
}
