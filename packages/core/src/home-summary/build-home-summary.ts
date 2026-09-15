// Home screen — **a summary of my workspace at one offset**.
//
// Summary cards and a graph, but the subject is not network statistics — it is **my workspace**. Two people opening the same home see different values. This function **composes** the pieces the router
// fetched at one offset into cards·sparkline·list. It neither calls the ledger nor reads the clock.
//
// Three things it upholds:
//   ① **The home of a user with zero party rights is not an empty scoreboard.** The whole card row is replaced with a single
//      line “this token has no party rights” — cards.status = "no_party_rights". **Holding no parties is not
//      the same as holding no rights**: a super reader (CanReadAsAnyParty) holds none of their own and reads
//      every party on the participant, so ① is decided on the scope, not on the party count. Judging it on the
//      count alone gave that viewer a page of “no party rights” cards directly beneath a viewer block, built
//      from this same input, reporting their scope as instance-wide.
//   ② If there are parties and zero contracts, it is an honest 0. A card whose lookup failed is not 0 but
//      {status:"unavailable", reason} (distinguishes a failed lookup from nothing; see docs/development.md, Backend core rules).
//   ③ Cards·list·sparkline are **the same snapshot** — all inputs are from the same offset, and the sparkline
//      comes from the same update array the list read.

import {
  buildRecentUpdates,
  type RecentUpdateRow,
} from "../recent-updates/build-recent-updates.ts";
import { buildTransferOffers } from "../transfer-offers/build-transfer-offers.ts";
import type {
  BuildViewerPartiesResult,
  ViewerScope,
} from "../viewer-parties/build-viewer-parties.ts";
import { bucketUpdatesByTime, type UpdateTimeDistribution } from "./bucket-updates-by-time.ts";
import { buildTokenKinds } from "./build-token-kinds.ts";

// The router passes “received / failed to receive” per piece in this shape. A piece that failed makes only that card
// unavailable, and the rest of the snapshot stands as is.
export type HomeSource<T> = { ok: true; value: T } | { ok: false; reason: string };

export type BuildHomeSummaryInput = {
  // The offset of this snapshot (GetLedgerEnd). Without it the whole home does not hold — the router blocks first.
  offset: number;
  // Start of the recent window (exclusive). The value with which the list·sparkline labels say “how far back the recent lookup went”.
  beginExclusive: number;
  viewer: BuildViewerPartiesResult;
  // The “now” for expiry judgment — the caller measures it and passes it in.
  asOf: string;
  // Active contracts — only counted, so the element shape is not inspected.
  contracts: HomeSource<readonly unknown[]>;
  // ACS queried with the standard TransferInstruction interface (createdEvent shape) + the interface id used for the query.
  offers: HomeSource<{ contracts: unknown; interfaceId: string }>;
  // ACS queried with the standard Holding interface + the interface id.
  holdings: HomeSource<{ contracts: unknown; interfaceId: string }>;
  // Updates of the recent window (UpdateEntry shape, all of them before the 20-item cut).
  updates: HomeSource<unknown>;
};

export type HomeUnavailable = { status: "unavailable"; reason: string };

export type HomeCountCard = { status: "ok"; count: number } | HomeUnavailable;

// The threshold for “imminent”. The design fixed only the emphasis and not a value — 24 hours is the implementation's assumption.
export const IMMINENT_EXPIRY_MS = 24 * 60 * 60 * 1000;

// One card of the “Pending offers stack” at the bottom of the home — the front of **the same set** (my turn·not expired) as the count in the card row
// Both selection and sorting end here — the screen only draws.
export type HomeOfferPreview = {
  contractId: string;
  direction: "received" | "internal";
  sender: string;
  receiver: string;
  amount: string;
  instrumentId: unknown;
  executeBefore: string;
  remainingMs: number;
  imminent: boolean;
};

// Upper bound on how many cards go on the stack. The design only said “a few” — 5 is a value the implementation chose.
export const PREVIEW_LIMIT = 5;

export type HomePendingOffersCard =
  | {
      status: "ok";
      // Count of those that are my turn (received·internal) and not yet expired — “things to do”.
      pending: number;
      // Of those, the first PREVIEW_LIMIT cards in order of soonest expiry — the material for the bottom stack.
      preview: HomeOfferPreview[];
      // Count of pending whose remaining time is at most IMMINENT_EXPIRY_MS.
      imminent: number;
      // Remaining ms of the nearest expiry among pending. null if pending is 0.
      soonestRemainingMs: number | null;
      // Count of those that were my turn but whose expiry has passed — not counted, but not hidden.
      expiredNotCounted: number;
      // Count of contracts that could not be read due to view errors — an error, not a value.
      problems: number;
    }
  | HomeUnavailable;

export type HomeTokensCard =
  | { status: "ok"; kinds: number; labels: string[]; problems: number }
  | HomeUnavailable;

export type HomeCards =
  | { status: "no_party_rights" }
  | {
      status: "ok";
      activeContracts: HomeCountCard;
      pendingOffers: HomePendingOffersCard;
      tokens: HomeTokensCard;
    };

export type HomeRecent =
  | {
      status: "ok";
      // Most recent on top, at most RECENT_LIMIT items.
      rows: RecentUpdateRow[];
      // Total number of updates in the window — the same as the sparkline's N.
      totalInWindow: number;
      beginExclusive: number;
    }
  | HomeUnavailable;

export type HomeSummary = {
  offset: number;
  viewer: { userId: string; partyCount: number; scope: ViewerScope };
  cards: HomeCards;
  sparkline: UpdateTimeDistribution;
  recent: HomeRecent;
};

export type BuildHomeSummaryResult =
  | { ok: true; summary: HomeSummary }
  | { ok: false; reason: string };

const RECENT_LIMIT = 20;

export function buildHomeSummary(input: BuildHomeSummaryInput): BuildHomeSummaryResult {
  if (!Number.isInteger(input.offset) || input.offset < 0) {
    return { ok: false, reason: "invalid_offset" };
  }
  if (!Number.isInteger(input.beginExclusive) || input.beginExclusive < 0) {
    return { ok: false, reason: "invalid_begin_exclusive" };
  }
  if (input.viewer.outcome !== "view") {
    // If we do not know whose eyes these are, there is nothing to summarize — the whole home fails.
    return { ok: false, reason: `viewer_unavailable:${input.viewer.reason}` };
  }
  const viewerParties = input.viewer.parties.map((p) => p.party);
  const parties = viewerParties;
  const viewer = {
    userId: input.viewer.userId,
    partyCount: viewerParties.length,
    scope: input.viewer.scope,
  };

  // A viewer reading as every party holds none of their own, so this is the scope's question, not the
  // count's. `readsAsAnyParty` is what the router built `{ anyParty: true }` from, and it is the reason the
  // cards below it have real numbers to show.
  const readsAsAnyParty = parties.length === 0 && input.viewer.scope === "instance-wide";

  if (parties.length === 0 && !readsAsAnyParty) {
    // ①: a single line instead of the card row. No list·graph either — the fact that there is nothing to see is the answer.
    return {
      ok: true,
      summary: {
        offset: input.offset,
        viewer,
        cards: { status: "no_party_rights" },
        sparkline: { status: "unavailable", reason: "no_party_rights" },
        recent: { status: "unavailable", reason: "no_party_rights" },
      },
    };
  }

  // ── My active contracts ────────────────────────────────────────────────────────────
  const activeContracts: HomeCountCard = !input.contracts.ok
    ? { status: "unavailable", reason: input.contracts.reason }
    : Array.isArray(input.contracts.value)
      ? { status: "ok", count: input.contracts.value.length }
      : { status: "unavailable", reason: "contracts_not_array" };

  // ── Pending received offers ──────────────────────────────────────────────────────
  //
  // **This card and the token card ask "mine", and a super reader has no answer to give.** "Received", "my
  // turn" and "which instruments I hold" are all relative to parties the viewer holds, and this viewer holds
  // none — they are reading as everyone. That is not zero offers and it is not a failed lookup, so it is
  // named: `no_own_parties`. Passing the empty list on instead would have counted every offer on the
  // participant as neither received nor sent, and silently reported 0.
  let pendingOffers: HomePendingOffersCard;
  if (readsAsAnyParty) {
    pendingOffers = { status: "unavailable", reason: "no_own_parties" };
  } else if (!input.offers.ok) {
    pendingOffers = { status: "unavailable", reason: input.offers.reason };
  } else {
    const built = buildTransferOffers(
      input.offers.value.contracts,
      input.offers.value.interfaceId,
      input.asOf,
      parties,
    );
    if (built.kind !== "available") {
      pendingOffers = { status: "unavailable", reason: built.reason };
    } else {
      // The direction is read as is from the value buildTransferOffers judged (chokepoint). It is not compared again here.
      const mine = built.view.rows.filter(
        (r) => r.directionInfo.direction === "received" || r.directionInfo.direction === "internal",
      );
      let pending = 0;
      let imminent = 0;
      let expiredNotCounted = 0;
      let soonest: number | null = null;
      const live: HomeOfferPreview[] = [];
      for (const row of mine) {
        if (row.expiry.passed) {
          expiredNotCounted += 1;
          continue;
        }
        pending += 1;
        const isImminent = row.expiry.remainingMs <= IMMINENT_EXPIRY_MS;
        if (isImminent) imminent += 1;
        if (soonest === null || row.expiry.remainingMs < soonest) soonest = row.expiry.remainingMs;
        live.push({
          contractId: row.contractId,
          // mine holds only received·internal — anything outside those two was already filtered out by the filter above.
          direction: row.directionInfo.direction === "internal" ? "internal" : "received",
          sender: row.sender,
          receiver: row.receiver,
          amount: row.amount,
          instrumentId: row.instrumentId,
          executeBefore: row.executeBefore,
          remainingMs: row.expiry.remainingMs,
          imminent: isImminent,
        });
      }
      // In order of soonest expiry. Equal remaining time falls back to contractId lexicographic order — to make the arrangement deterministic.
      live.sort((a, b) =>
        a.remainingMs !== b.remainingMs
          ? a.remainingMs - b.remainingMs
          : a.contractId < b.contractId
            ? -1
            : 1,
      );
      pendingOffers = {
        status: "ok",
        pending,
        preview: live.slice(0, PREVIEW_LIMIT),
        imminent,
        soonestRemainingMs: soonest,
        expiredNotCounted,
        problems: built.view.problems.length,
      };
    }
  }

  // ── My tokens (kind count only) ───────────────────────────────────────────────────────
  let tokens: HomeTokensCard;
  if (readsAsAnyParty) {
    tokens = { status: "unavailable", reason: "no_own_parties" };
  } else if (!input.holdings.ok) {
    tokens = { status: "unavailable", reason: input.holdings.reason };
  } else {
    const built = buildTokenKinds(
      input.holdings.value.contracts,
      input.holdings.value.interfaceId,
      parties,
    );
    tokens =
      built.kind !== "available"
        ? { status: "unavailable", reason: built.reason }
        : {
            status: "ok",
            kinds: built.view.count,
            labels: built.view.instruments.map((i) => i.label),
            problems: built.view.problems.length,
          };
  }

  // ── Recent transactions list + sparkline (same array) ─────────────────────────────────
  let recent: HomeRecent;
  let sparkline: UpdateTimeDistribution;
  if (!input.updates.ok) {
    recent = { status: "unavailable", reason: input.updates.reason };
    sparkline = { status: "unavailable", reason: input.updates.reason };
  } else if (!Array.isArray(input.updates.value)) {
    recent = { status: "unavailable", reason: "updates_not_array" };
    sparkline = { status: "unavailable", reason: "updates_not_array" };
  } else {
    // Sort the whole window once; the list takes the top 20, the graph takes all — the two N's cannot diverge.
    const all = buildRecentUpdates(input.updates.value, {
      limit: Math.max(1, input.updates.value.length),
    });
    if (!all.ok) {
      recent = { status: "unavailable", reason: all.reason };
      sparkline = { status: "unavailable", reason: all.reason };
    } else {
      recent = {
        status: "ok",
        rows: all.rows.slice(0, RECENT_LIMIT),
        totalInWindow: all.rows.length,
        beginExclusive: input.beginExclusive,
      };
      sparkline = bucketUpdatesByTime(all.rows);
    }
  }

  return {
    ok: true,
    summary: {
      offset: input.offset,
      viewer,
      cards: { status: "ok", activeContracts, pendingOffers, tokens },
      sparkline,
      recent,
    },
  };
}
