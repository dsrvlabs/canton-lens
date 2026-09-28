// **Which slots anything has actually read, written down where a diff will show it.**
//
// The mappings are already required to have a rule for every slot the contract declares — but "there is a
// rule" and "anything ever ran that rule" are different statements, and only the first was being made. A
// rule sitting under a union branch the recording never produced is a sentence nobody has read against
// anything: it can say whatever it likes, and mutation cannot find it because there is nothing to change.
//
// So the run writes down every slot it ran over, and this file turns that into a list of every slot the
// contract has, marked judged or not. **A slot nobody judged needs a reason**, and the reason is the point:
// some are declined on purpose (`unjudged`), some are branches no ledger here produces, and some are holes.
// The three read very differently and only the last is a defect.
//
// It is a committed file rather than a threshold. A number to beat invites the number to be lowered; a list
// in a diff makes "this slot stopped being judged" a line somebody has to approve.
import { openApiDocument } from "../openapi.ts";
import { type AnyRule, type Branches, reachableSchemas, type Table } from "./mapping.ts";
import { MAPPINGS } from "./mappings/index.ts";

type Schema = Record<string, unknown>;
const schemas = openApiDocument.components.schemas as unknown as Record<string, Schema>;

const isBranches = (table: Table): table is Branches =>
  typeof (table as Branches).by === "string" && Array.isArray((table as Branches).of);

export type SlotStanding = {
  /** `"ContractsResponse.rows"`. */
  at: string;
  /** Judged at least once during the run. */
  judged: boolean;
  /**
   * Why a rule exists for it at all, when nothing judged it: the sentence a declining rule gives, or the
   * rule's own sentence when it simply was not reached.
   */
  says: string;
};

/**
 * Every slot every mapping describes, and whether the run ran its rule.
 *
 * The slots come from the **contract**, not from the tables — a table missing a slot entirely is
 * `coverage()`'s finding, and this would otherwise not mention it at all.
 */
export function slotStandings(ran: ReadonlyMap<string, number>): SlotStanding[] {
  const standings = new Map<string, SlotStanding>();
  const add = (schema: string, slot: string, rule: AnyRule | undefined) => {
    const at = `${schema}.${slot}`;
    if (standings.has(at)) return;
    standings.set(at, {
      at,
      judged: (ran.get(at) ?? 0) > 0,
      says: rule?.says ?? "no rule describes this slot",
    });
  };

  for (const mapping of new Set(Object.values(MAPPINGS))) {
    for (const schema of reachableSchemas(mapping.root)) {
      const table = mapping.slots[schema];
      if (table === undefined) continue;
      // The slot names the **contract** declares, so a slot a table forgot is still listed here.
      const declared = new Set<string>();
      const collect = (shape: unknown) => {
        if (shape === null || typeof shape !== "object") return;
        const record = shape as Record<string, unknown>;
        for (const name of Object.keys((record.properties as Schema) ?? {})) declared.add(name);
        for (const branch of (record.anyOf as unknown[]) ?? []) collect(branch);
        for (const branch of (record.oneOf as unknown[]) ?? []) collect(branch);
      };
      collect(schemas[schema]);
      for (const slot of declared) {
        const rule = isBranches(table)
          ? table.of.map((branch) => branch.slots[slot]).find((one) => one !== undefined)
          : table[slot];
        add(schema, slot, rule);
      }
    }
  }
  return [...standings.values()].sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * The list as a file: every slot nobody judged, with what its rule says.
 *
 * The judged ones are counted rather than listed — there are several hundred, they are the ordinary case,
 * and a file that is mostly "fine" is a file nobody reads. What has to be looked at is the other list.
 */
export function writeStandings(standings: readonly SlotStanding[]): string {
  const unjudged = standings.filter((one) => !one.judged);
  const lines = [
    "# Slots nothing judged",
    "",
    "**Generated — `apps/backend/src/check/coverage.test.ts` writes it and requires it to match.**",
    "",
    "Every slot of every schema a mapped answer can reach has a rule (that is `coverage()`'s business). This",
    "is the other half: whether anything ever *ran* that rule. A rule under a union branch no ledger here",
    "produces has never been read against anything, and mutation cannot find it — there is nothing to break.",
    "",
    "A line leaving this list is good news. A line arriving is a question: which branch stopped being",
    "reached, and was that the seed or the product?",
    "",
    `${standings.length} slots · ${standings.length - unjudged.length} judged · ${unjudged.length} not`,
    "",
    "| slot | what its rule says |",
    "| --- | --- |",
    ...unjudged.map((one) => `| \`${one.at}\` | ${one.says.replace(/\|/g, "\\|")} |`),
    "",
  ];
  return lines.join("\n");
}
