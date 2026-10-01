// **Live** — the Transactions screen's live mode (`#/transactions?live=1`), for a screen that stays open.
// Updates as the participant records them, newest on top, read a few seconds at a time by asking the one
// question that stays small however long the screen is up: "what happened after the point I last saw"
// (/api/updates/after/{offset}). When nothing moved, that answer is one ledger-end read and an empty list.
//
// **Nothing runs while the switch is off.** The timer is this component's and is cleared with it, and the
// component is only mounted while the address says live; no other screen re-reads on a clock. It also stops
// on its own when the tab is hidden (the tick is skipped), when a read fails (until Retry), and when paused.
//
// The fetching half holds the timer and the tail. The drawing half is a function of its props and nothing
// else, so a test can hand it a recorded answer and look at the screen (screens.test.mjs).
import { Button, MessageRow, Muted, Scroll, Section, Table } from "@canton-lens/design-system";
import { useCallback, useEffect, useRef, useState } from "react";
import { messageOf } from "../api/client.ts";
import type { RecentUpdateRow, UpdatesAfterResponse, UpdatesResponse } from "../api/types.ts";
import { fmtOffset, fmtTime } from "../format/format.ts";
import { UpdateRows } from "../format/rows.tsx";
import { hashQuery, hashWith, setHashParams } from "../route/hash.ts";
import { useSession } from "../session/SessionContext.tsx";

/** Seconds between two reads when the address names none. The choices offered on screen. */
export const LIVE_DEFAULT_EVERY_S = 3;
export const LIVE_EVERY_CHOICES_S = [1, 3, 10] as const;
const LIVE_MIN_EVERY_S = 1;
const LIVE_MAX_EVERY_S = 60;
/** How many rows the screen keeps. A wall display runs for days; the tail would otherwise grow without bound. */
const LIVE_KEEP = 200;
/** How many rows the first read asks for, so the screen is not blank while it waits for the first new one. */
const SEED_LIMIT = 50;

/** The interval the address asks for (`?every=5`), clamped — a zero or a word is the default. */
export function everyOf(hash: string): number {
  const raw = Number(hashQuery(hash).get("every"));
  if (!Number.isFinite(raw) || raw <= 0) return LIVE_DEFAULT_EVERY_S;
  return Math.min(LIVE_MAX_EVERY_S, Math.max(LIVE_MIN_EVERY_S, Math.round(raw)));
}
/** `?big=1` — larger type, for a screen read from across a room. */
export const isBig = (hash: string): boolean => hashQuery(hash).get("big") === "1";
/** `?live=1` — the switch. The Transactions screen hands itself to this mode while it is on. */
export const isLive = (hash: string): boolean => hashQuery(hash).get("live") === "1";

export type LiveFeed = {
  /** Newest first. At most LIVE_KEEP. */
  rows: RecentUpdateRow[];
  /** The ledger end the last answer read at — the next question starts here. */
  offset: number;
  /** The ids that arrived by the tail rather than the first read. They are drawn with the entrance. */
  fresh: ReadonlySet<string>;
  /** A range the server did not read because the screen had been away too long: (from, to]. */
  gap: { from: number; to: number } | null;
  /** When the last answer was read (the server's readAt). */
  readAt: string | null;
};

// **The fetching half.** It holds the timer, the tail and the answer; it draws nothing.
export function Live({ hash }: { hash: string }) {
  const { api } = useSession();
  const every = everyOf(hash);
  const [feed, setFeed] = useState<LiveFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  // One read at a time. A slow answer must not pile the next tick on top of it.
  const inFlight = useRef(false);
  // The tick reads the offset to ask with from here rather than from a closure, so the timer never has to
  // be rebuilt for every answer.
  const offsetRef = useRef<number | null>(null);

  // The first read — the recent list at the ledger end, cut to a page, so the screen opens with something
  // on it and a point to continue from.
  const seed = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const u = await api<UpdatesResponse>(`/api/updates?limit=${SEED_LIMIT}`);
      offsetRef.current = u.offset;
      setFeed({ rows: u.rows, offset: u.offset, fresh: new Set(), gap: null, readAt: u.readAt });
      setError(null);
    } catch (e: unknown) {
      setError(messageOf(e));
    } finally {
      inFlight.current = false;
    }
  }, [api]);

  // One tick: everything after the point last seen.
  const tick = useCallback(async () => {
    const after = offsetRef.current;
    if (after === null || inFlight.current) return;
    // A hidden tab reads nothing — nobody is looking, and the participant is shared.
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    inFlight.current = true;
    try {
      const res = await api<UpdatesAfterResponse>(`/api/updates/after/${after}`);
      offsetRef.current = res.offset;
      setFeed((prev) => {
        if (prev === null) return prev;
        const known = new Set(prev.rows.map((r) => r.updateId));
        const arrived = res.rows.filter((r) => !known.has(r.updateId));
        const fresh =
          arrived.length === 0
            ? prev.fresh
            : new Set([...prev.fresh, ...arrived.map((r) => r.updateId)]);
        // The server cut the range: what lies between the point we asked from and where it began was not
        // read. Said, not drawn as "nothing happened".
        const gap =
          res.beginExclusive > prev.offset
            ? { from: prev.offset, to: res.beginExclusive }
            : prev.gap;
        return {
          rows: [...arrived, ...prev.rows].slice(0, LIVE_KEEP),
          offset: res.offset,
          fresh,
          gap,
          readAt: res.readAt,
        };
      });
      setError(null);
    } catch (e: unknown) {
      // The timer stops on a failure (the effect below) — a screen that keeps hammering a node that just
      // refused it is the wrong screen. Retry starts it again.
      setError(messageOf(e));
    } finally {
      inFlight.current = false;
    }
  }, [api]);

  // Seed once, as soon as the screen is drawn. The other list screens wait for the session's full read
  // because they take its offset; this one takes none, and that read can run tens of seconds on a large
  // participant (the package catalogue) — a wall display should not sit blank for it.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    void seed();
  }, [seed]);

  // The clock. Rebuilt only when the interval changes or the feed stops or starts.
  const running = feed !== null && error === null && !paused;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => void tick(), every * 1000);
    return () => clearInterval(id);
  }, [running, every, tick]);

  return (
    <LiveView
      feed={feed}
      error={error}
      paused={paused}
      every={every}
      big={isBig(hash)}
      hash={hash}
      onPause={() => setPaused((p) => !p)}
      onRetry={() => {
        setError(null);
        // Clearing the error restarts the clock. With no first answer yet there is no clock to restart, so
        // the first read is made again here.
        if (feed === null) void seed();
      }}
    />
  );
}

// **The drawing half.** Rows, the state line, and the controls — from props alone.
export function LiveView({
  feed,
  error,
  paused,
  every,
  big,
  hash,
  onPause,
  onRetry,
}: {
  feed: LiveFeed | null;
  error: string | null;
  paused: boolean;
  every: number;
  big: boolean;
  hash: string;
  onPause: () => void;
  onRetry: () => void;
}) {
  const rows = feed?.rows ?? [];
  const state =
    error !== null ? (
      <span className="live-state live-state--problem">● stopped — read failed</span>
    ) : paused ? (
      <span className="live-state live-state--paused">❚❚ paused</span>
    ) : feed === null ? (
      <span className="live-state">● reading…</span>
    ) : (
      <span className="live-state live-state--on">● live · every {every}s</span>
    );
  return (
    <Section
      id="tx-box"
      className={big ? "live live-big" : "live"}
      title="Transactions"
      subtitle="live — as the participant records them"
      note={
        <span id="live-state">
          {state}
          {feed !== null ? (
            <Muted>
              {" "}
              · ledger end {fmtOffset(feed.offset)}
              {feed.readAt ? ` · read ${fmtTime(feed.readAt)}` : ""}
            </Muted>
          ) : null}
        </span>
      }
      foot={
        <span id="live-controls" className="live-controls">
          {/* Off — back to the paged list. Only the switch leaves the address; big and every stay for next time. */}
          <Button
            id="tx-live"
            size="xs"
            variant="outline"
            onClick={() => setHashParams({ live: null })}
            title="Back to the paged list"
          >
            ● Live on
          </Button>
          <Button size="xs" onClick={onPause} disabled={error !== null || feed === null}>
            {paused ? "Resume" : "Pause"}
          </Button>
          <Muted>
            {" "}
            every{" "}
            {LIVE_EVERY_CHOICES_S.map((s, i) => (
              <span key={s}>
                {i > 0 ? " · " : ""}
                {s === every ? (
                  <b>{s}s</b>
                ) : (
                  <a href={hashWith({ every: String(s) }, hash)}>{s}s</a>
                )}
              </span>
            ))}
            {" · "}
            <a href={hashWith({ big: big ? null : "1" }, hash)}>
              {big ? "normal type" : "big type"}
            </a>
          </Muted>
          <Muted className="live-controls__note">
            Polls only while the switch is on and this screen is open. Hidden tabs read nothing.
          </Muted>
        </span>
      }
    >
      <Scroll>
        <Table id="live-list">
          <tbody>
            {error !== null ? (
              <MessageRow tone="problem">
                Could not fetch — {error}.{" "}
                <Button size="xs" variant="outline" onClick={onRetry}>
                  Retry
                </Button>
              </MessageRow>
            ) : null}
            {feed?.gap ? (
              // Said at the top, where the newest rows are: everything above it arrived after the gap.
              <MessageRow>
                Offsets {fmtOffset(feed.gap.from + 1)} to {fmtOffset(feed.gap.to)} were not read —
                this screen was away longer than the feed reaches back. Switch Live off to page
                through them.
              </MessageRow>
            ) : null}
            {feed === null ? (
              error === null ? (
                <MessageRow>Reading the ledger…</MessageRow>
              ) : null
            ) : rows.length > 0 ? (
              <UpdateRows
                rows={rows}
                rowClass={(r) => (feed.fresh.has(r.updateId) ? "live-fresh" : undefined)}
              />
            ) : (
              <MessageRow>
                Nothing visible to you has happened yet — waiting for the next update
              </MessageRow>
            )}
          </tbody>
        </Table>
      </Scroll>
    </Section>
  );
}
