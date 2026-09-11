// Recent-window updates + the active contracts -> **contract lifetimes** (the Timeline screen's bars).
//
// One lifeline is one contract: the point it was created and the point it was archived, both as ledger
// offsets. Canton has no blocks, so the offset is the mark that counts one thing after another.
//
// **Why two inputs.** The update window says what was created and archived *inside* the window; the ACS says
// what is alive *now*. A contract that had no event in the window has no row in the updates at all yet lived
// through the whole of it, and a contract that died before the window is in neither (that one cannot be
// drawn, and the screen says so).
//
// **"End unknown" is kept apart from "still alive".** An archived event carries no signatories or observers
// (the ledger does not give them; only witnessParties), so a party-filtered window can miss the end of a
// contract — the same rule filter-recent-updates states. Calling that "alive" would be inventing a fact. A
// contract with no archive in the window and no place in the active contracts is `unknown`, not `alive`.
//
// This function judges nothing about visibility: both inputs are already the requester's visible scope, and
// they arrive as values other core functions have finished judging (buildRecentUpdates · buildContractList).
// It also reads no clock and computes no geometry — where a bar sits on screen is the screen's arithmetic.

import type { ContractListRow } from "../contract-list/build-contract-list.ts";
import type { RecentUpdateRow } from "../recent-updates/build-recent-updates.ts";

export type LifelineState = "alive" | "archived" | "unknown";

export type Lifeline = {
  contractId: string;
  // In substance the packageId (hex) — the same rule as contract-list. packageName is the readable one, when known.
  package: string;
  packageName: string | null;
  module: string;
  entity: string;
  /**
   * Who the contract belongs to — signatories and observers together, the same material the list filters on.
   * There is no single owner in Daml: a contract can carry several signatories, and observers on top, so this is a
   * list rather than one party. Empty when the only thing seen was an archive: that event carries no signatories or
   * observers (only witnessParties), and a witness is not a stakeholder.
   */
  parties: string[];
  // Where the bar starts. A contract born before the window is pulled to the window's edge, and startKnown
  // says that the edge is not its birth.
  start: number;
  startKnown: boolean;
  end: number;
  // false for both "still alive" and "end unknown" — state tells the two apart.
  endKnown: boolean;
  state: LifelineState;
  /** The update that archived it — an archived contract has no detail page (the ACS no longer holds it), so this is where the screen can go instead. */
  archivedBy: string | null;
  createdAt: string | null;
};

export type LifelineGroup = {
  /** `module:entity` — the key the screen groups bars under. */
  key: string;
  module: string;
  entity: string;
  lines: Lifeline[];
};

export type LifelineWindow = { from: number; to: number };

type Seen = { offset: number; updateId: string; effectiveAt: string };

export function buildLifelines(
  updates: readonly RecentUpdateRow[],
  active: readonly ContractListRow[],
  window: LifelineWindow,
): Lifeline[] {
  const created = new Map<string, Seen>();
  const archived = new Map<string, Seen>();
  const template = new Map<
    string,
    {
      package: string;
      packageName: string | null;
      module: string;
      entity: string;
      parties: string[];
    }
  >();
  for (const update of updates) {
    for (const event of update.events) {
      const seen = {
        offset: update.offset,
        updateId: update.updateId,
        effectiveAt: update.effectiveAt,
      };
      const into = event.kind === "created" ? created : archived;
      // A contract is created once and archived once, but if overlapping windows are ever passed in,
      // the **earliest** is the one kept rather than the last one seen.
      const before = into.get(event.contractId);
      if (before === undefined || seen.offset < before.offset) into.set(event.contractId, seen);
      if (!template.has(event.contractId)) {
        template.set(event.contractId, {
          package: event.package,
          packageName: null,
          module: event.module,
          entity: event.entity,
          // created carries signatories ∪ observers; archived carries neither (the envelope leaves it empty).
          parties: event.kind === "created" ? event.parties : [],
        });
      }
    }
  }
  // The ACS row is the better source where both exist: it carries packageName, and it knows the creation
  // offset of a contract made before the window.
  const alive = new Map<string, ContractListRow>();
  for (const row of active) {
    alive.set(row.contractId, row);
    template.set(row.contractId, {
      package: row.package,
      packageName: row.packageName,
      module: row.module,
      entity: row.entity,
      // My own parties first — on my screen the answer to "whose is this" starts with whether it is mine.
      parties: [...row.myRoles.map((r) => r.party), ...row.counterpartyParty],
    });
  }

  const lines: Lifeline[] = [];
  for (const [contractId, t] of template) {
    const born = created.get(contractId);
    const died = archived.get(contractId);
    const living = alive.get(contractId);
    const bornAt = born?.offset ?? living?.offset ?? null;
    const startKnown = bornAt !== null && bornAt >= window.from;
    lines.push({
      contractId,
      package: t.package,
      packageName: t.packageName,
      module: t.module,
      entity: t.entity,
      parties: t.parties,
      start: startKnown && bornAt !== null ? bornAt : window.from,
      startKnown,
      end: died !== undefined ? died.offset : window.to,
      endKnown: died !== undefined,
      state: died !== undefined ? "archived" : living !== undefined ? "alive" : "unknown",
      archivedBy: died?.updateId ?? null,
      createdAt: living?.createdAt ?? born?.effectiveAt ?? null,
    });
  }
  return lines;
}

// Grouped by template, because dozens of bars keyed only by contract id do not say what the crowd is.
// The bigger crowd first (count descending, then name), and inside a crowd the earlier start first — the
// staircase should run from top-left to bottom-right so that "made later" is the thing that catches the eye.
export function groupLifelines(lines: readonly Lifeline[]): LifelineGroup[] {
  const groups = new Map<string, LifelineGroup>();
  for (const line of lines) {
    const key = `${line.module}:${line.entity}`;
    const group = groups.get(key) ?? { key, module: line.module, entity: line.entity, lines: [] };
    group.lines.push(line);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.lines.sort((a, b) => a.start - b.start || a.contractId.localeCompare(b.contractId));
  }
  return Array.from(groups.values()).sort(
    (a, b) => b.lines.length - a.lines.length || a.key.localeCompare(b.key),
  );
}
