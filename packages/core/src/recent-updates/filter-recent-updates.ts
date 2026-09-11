// Filter and paging for the Transactions list.
//
// - The filter is **template + parties**. Multiple parties use OR, and an update is a bundle of events, so it passes if any selected party
//   appears on any event. The party material is (signatories ∪ observers of created) ∪ witnessParties, so it also matches on a counterparty's id. Archived has
//   no signatories/observers, so only witnessParties remains. An update carrying only Archived therefore does not match on a counterparty's id;
//   that is accepted rather than papered over, because the layer-1 response carries no material to recover the counterparty from.
//   The template match is an exact match on the parsed `module:entity` or `entity` — the package hash is not looked at (same name·different hash
//   does occur, and users do not type hashes). If all three pieces (`pkg:module:entity`) are given, that is accepted too.
// - Paging is **keyset** within the window (`before` = starting from those with an offset smaller than this). 500 items are not dumped onto one screen.
// - Two kinds of empty result are distinguished: the window itself is empty (total 0) vs nothing matched the filter (matched 0, total > 0).
//   The screen says these two in different sentences — not “none” but “none in this window, and older history is not in this view”.
//
// Judgment ends here. The screen passes the URL parameters through as is and draws the result.

import type { RecentUpdateEventRow, RecentUpdateRow } from "./build-recent-updates.ts";

export type UpdateFilter = { template?: string; parties?: string[] };

export const UPDATES_PAGE_SIZE = 25;

export type UpdatesPage = {
  rows: RecentUpdateRow[];
  // Total count in the window (before the filter) — the material for judging “the window is empty”.
  total: number;
  // Count passing the filter — independent of the page.
  matched: number;
  // If there is a next page, its `before` value (the offset of the last row of this page). Otherwise null.
  nextBefore: number | null;
  filter: UpdateFilter;
};

export type FilterUpdatesResult = { ok: true; page: UpdatesPage } | { ok: false; reason: string };

// Reads the template string as one of three: entity · module:entity · pkg:module:entity. Anything else cannot match (empty result).
function templateMatcher(template: string): (e: RecentUpdateEventRow) => boolean {
  const parts = template.split(":");
  if (parts.length === 1) return (e) => e.entity === template;
  if (parts.length === 2) return (e) => e.module === parts[0] && e.entity === parts[1];
  if (parts.length === 3)
    return (e) => e.package === parts[0] && e.module === parts[1] && e.entity === parts[2];
  return () => false;
}

export function eventMatchesFilter(event: RecentUpdateEventRow, filter: UpdateFilter): boolean {
  if (filter.template !== undefined && filter.template !== "") {
    if (!templateMatcher(filter.template)(event)) return false;
  }
  if (filter.parties?.length) {
    if (
      !filter.parties.some(
        (party) => event.witnessParties.includes(party) || event.parties.includes(party),
      )
    )
      return false;
  }
  return true;
}

export function updateMatchesFilter(row: RecentUpdateRow, filter: UpdateFilter): boolean {
  return row.events.some((e) => eventMatchesFilter(e, filter));
}

export function filterAndPageUpdates(
  rows: readonly RecentUpdateRow[],
  filter: UpdateFilter,
  opts?: { before?: number; limit?: number },
): FilterUpdatesResult {
  const limit = opts?.limit ?? UPDATES_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit <= 0) return { ok: false, reason: "invalid_limit" };
  if (opts?.before !== undefined && !Number.isInteger(opts.before)) {
    return { ok: false, reason: "invalid_before" };
  }
  const clean: UpdateFilter = {
    ...(filter.template ? { template: filter.template } : {}),
    ...(filter.parties?.length ? { parties: Array.from(new Set(filter.parties)) } : {}),
  };
  // Newest first — buildRecentUpdates already ordered by offset descending, but it is guaranteed again here (no reliance on input order).
  const sorted = rows.slice().sort((a, b) => b.offset - a.offset);
  const matched = sorted.filter((r) => updateMatchesFilter(r, clean));
  const from =
    opts?.before === undefined
      ? matched
      : matched.filter((r) => r.offset < (opts.before as number));
  const page = from.slice(0, limit);
  const last = page[page.length - 1];
  const nextBefore = from.length > limit && last !== undefined ? last.offset : null;
  return {
    ok: true,
    page: { rows: page, total: rows.length, matched: matched.length, nextBefore, filter: clean },
  };
}
