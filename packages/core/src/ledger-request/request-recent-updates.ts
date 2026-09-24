import { callGetUpdates } from "./request-updates.ts";
import type { LedgerCallResult, LedgerPartyFilter, LedgerSend } from "./types.ts";

// **"Recent" is counted in what the viewer can see, not in offsets.**
//
// An offset is a position on the participant, and a participant is shared: every project on it, and the
// network's own rounds, advance the same counter. A window of the last 500 offsets therefore holds a
// different amount of *this viewer's* history on every ledger — on a quiet development stack it is the
// whole ledger, on a busy shared participant it was measured at about two hours, and a viewer whose
// contracts settle a few times a day opened the transactions screen to nothing. Nothing was hidden; the
// window was simply too narrow to hold anything of theirs.
//
// The ledger cannot be asked for "the newest N updates I can see": /v2/updates takes an offset range and
// streams forward. So the window is asked for in growing steps. It starts at RECENT_UPDATES_LOOKBACK
// offsets and, while it holds fewer than RECENT_UPDATES_TARGET of the viewer's transactions, it widens by
// RECENT_UPDATES_WIDEN_FACTOR — each step reading only the older part not yet read — until it holds that
// many, reaches the ledger's start, or reaches RECENT_UPDATES_MAX_LOOKBACK. The bound is what keeps this
// from scanning from 0: older history is still not served, only "recent" is defined by content rather than
// by a fixed width.
//
// **A pruned past ends the widening, not the read.** The participant retains history only back to its
// pruning point. If a wider step reaches past it, the node refuses that step by name, and the window
// stays at the last step that was answered whole — what is returned is exactly what was read, and
// beginExclusive says where it starts. A step that fails for any other reason fails the whole call, as
// every other list read here does: half a window presented as the window is the failure this product
// refuses to produce.
export const RECENT_UPDATES_LOOKBACK = 500;
export const RECENT_UPDATES_TARGET = 500;
export const RECENT_UPDATES_WIDEN_FACTOR = 4;
export const RECENT_UPDATES_MAX_LOOKBACK = 128_000;

export type RecentUpdatesRead = {
  /** Every element the node returned across the steps, in the node's ascending order. */
  updates: unknown[];
  /** Where the window starts (exclusive). The screens say "how far back did we look" with this. */
  beginExclusive: number;
};

/** A transaction, as opposed to a reassignment, a topology change or an offset checkpoint. */
const isTransaction = (element: unknown): boolean => {
  if (typeof element !== "object" || element === null) return false;
  const update = (element as { update?: unknown }).update;
  return typeof update === "object" && update !== null && "Transaction" in update;
};

export const countTransactions = (elements: readonly unknown[]): number =>
  elements.filter(isTransaction).length;

// callGetUpdates is typed as the generic list read; the pages it assembles are always an array.
const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * The next window width, or null when the current one is as wide as this read goes.
 *
 * Exported so the check can restate the same schedule rather than a copy of it.
 */
export function widenLookback(lookback: number): number | null {
  if (lookback >= RECENT_UPDATES_MAX_LOOKBACK) return null;
  return Math.min(RECENT_UPDATES_MAX_LOOKBACK, lookback * RECENT_UPDATES_WIDEN_FACTOR);
}

export async function callGetRecentUpdates(
  send: LedgerSend,
  filter: LedgerPartyFilter,
  endInclusive: number,
): Promise<LedgerCallResult<RecentUpdatesRead>> {
  let lookback = RECENT_UPDATES_LOOKBACK;
  let beginExclusive = Math.max(0, endInclusive - lookback);
  const first = await callGetUpdates(send, filter, beginExclusive, endInclusive);
  if (!first.ok) return first;
  let updates: unknown[] = asList(first.value);
  let visible = countTransactions(updates);

  while (visible < RECENT_UPDATES_TARGET && beginExclusive > 0) {
    const wider = widenLookback(lookback);
    if (wider === null) break;
    const olderBegin = Math.max(0, endInclusive - wider);
    // Only the part not yet read: (olderBegin, beginExclusive]. The steps abut, so the assembled list is
    // the whole window and nothing is read twice.
    const older = await callGetUpdates(send, filter, olderBegin, beginExclusive);
    if (!older.ok) {
      if (older.reason === "pruned") break;
      return older;
    }
    const olderList = asList(older.value);
    updates = [...olderList, ...updates];
    visible += countTransactions(olderList);
    lookback = wider;
    beginExclusive = olderBegin;
  }
  return { ok: true, value: { updates, beginExclusive } };
}
