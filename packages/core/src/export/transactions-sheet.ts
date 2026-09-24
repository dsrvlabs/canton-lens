// The Transactions screen's rows, as a sheet.
//
// **One line per event, not per update.** An update holds any number of created and archived events,
// and the screen nests them under the update. A spreadsheet has no nesting, and the alternative —
// one line per update with the events joined into a cell — produces exactly the column nobody can
// filter or pivot on, which is the reason to open this in a spreadsheet at all. So the update's
// fields repeat down its events, the shape every spreadsheet tool expects.
//
// An update with no visible event still gets a line, with the event columns empty. Dropping it would
// make the export disagree with the count the screen just showed.

import type { RecentUpdateRow } from "../recent-updates/build-recent-updates.ts";

export const TRANSACTIONS_COLUMNS = [
  "Offset",
  "Update ID",
  "Effective at",
  "Submitted by you",
  "Event",
  "Contract ID",
  "Package ID",
  "Module",
  "Entity",
  "Parties",
  "Witness parties",
] as const;

// Several parties in one cell. Excel's own list separator follows the reader's locale, so a comma
// would split into columns for some of them on re-import; a semicolon and a space is the separator
// that survives and still reads as a list.
const joinParties = (parties: readonly string[]): string => parties.join("; ");

export function buildTransactionsSheetRows(updates: readonly RecentUpdateRow[]): string[][] {
  const rows: string[][] = [[...TRANSACTIONS_COLUMNS]];
  for (const update of updates) {
    // Written once and reused, so the repeated columns cannot drift between an update's lines.
    const head = [
      String(update.offset),
      update.updateId,
      update.effectiveAt,
      update.submittedByYou ? "yes" : "no",
    ];
    if (update.events.length === 0) {
      rows.push([...head, "", "", "", "", "", "", ""]);
      continue;
    }
    for (const event of update.events) {
      rows.push([
        ...head,
        event.kind,
        event.contractId,
        event.package,
        event.module,
        event.entity,
        joinParties(event.parties),
        joinParties(event.witnessParties),
      ]);
    }
  }
  return rows;
}

// `canton-lens-transactions-2026-09-16T04-52-05Z.xlsx`. The instant is in the name because two
// exports of "recent" taken minutes apart are different documents, and a file that overwrites the
// previous one hides that. Colons cannot appear in a filename on Windows, so they become hyphens.
export function transactionsFileName(at: Date): string {
  const stamp = at
    .toISOString()
    .replace(/\.\d+Z$/, "Z")
    .replace(/:/g, "-");
  return `canton-lens-transactions-${stamp}.xlsx`;
}
