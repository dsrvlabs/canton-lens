// **The rule for one slot, written by a person.**
//
// The check's shape is: node JSON in → rule → the API JSON we expect → compared with what the API actually
// said. This file holds the rule side and the comparison; a mapping itself (mappings/) holds the rules.
//
// Two things decided this design:
//
//   · **A person writes the rules, not a machine.** Deriving them from the product code would derive the bugs
//     with them — the expected output would be wrong in exactly the way the real one is, and it would pass.
//     The independence comes from someone reading the code and writing down, again, the rule they understood.
//     For the same reason a mapping must never call a product function such as `buildContractList`.
//   · **The unit is (schema, slot), not a field name.** `amount` on the offers path is not the contract's
//     `createArgument.amount` but the interface view's (core/transfer-offers/build-transfer-offers.ts:136).
//     Matching by name would have called that a passthrough. So every slot of every schema the response can
//     reach needs its own line, and `coverage` below turns a missing line red.
import { openApiDocument } from "../openapi.ts";
import type { NodeCall } from "./trace.ts";

// Everything a rule is allowed to look at: who asked, what they asked for, the node calls that one question
// produced, and the instant the check supplied. **Not the response** — the answer is what is being judged.
export type CheckContext = {
  user: string;
  url: string;
  trace: readonly NodeCall[];
  now: { iso: string; ms: number };
  /**
   * **What the caller's own ledger token says, decoded — never the token.** One answer echoes three of its
   * claims back (the session screen says whose issuer it is and how long it lasts), and no rule could state
   * that from the node's answers alone. Whoever builds `ask` holds the token and splits out the payload, so
   * no credential reaches a rule, a report or a failure message. `null` when it is not a JWT at all — which
   * is what the recorded tape's stand-in tokens are.
   */
  callerToken: Record<string, unknown> | null;
};

export type Origin =
  /** The node's own value, carried through untouched. */
  | "node"
  /** A value this application made up: a count, a join, a split, a rename. */
  | "app";

// The part a reviewer reads. `says` is the sentence; for `node` it is the path in the node object, so the
// sentence and the machine cannot drift apart.
export type AnyRule = { says: string; origin: Origin };
export type Rule<Item> = AnyRule & { from: (item: Item) => unknown };

/** One (schema, slot) table. Every slot the contract declares needs an entry. */
export type SlotTable = Record<string, AnyRule>;

// **A union of object branches.** Several schemas in the contract are not one shape but a choice between
// shapes, told apart by one slot holding a constant: `status: "ok"` against `status: "no_party_found"`,
// `kind: "present"` against `kind: "none"`. A single slot table cannot describe that — the slots differ per
// branch — and describing only one branch would leave the others unmapped in silence.
//
// `when` carries *every* value of the discriminant that lands on this shape, because one branch can serve
// several: TypedValue's first branch covers eight kinds that all render as a string.
export type Branches = {
  /** The slot whose constant value tells the branches apart. */
  by: string;
  of: readonly { when: readonly string[]; slots: SlotTable }[];
};

export type Table = SlotTable | Branches;

const isBranches = (table: Table): table is Branches =>
  typeof (table as Branches).by === "string" && Array.isArray((table as Branches).of);

/** Returned by a rule for a key that should not be in the response at all. */
export const ABSENT = Symbol("absent");

// The node's value, named by where it sits in the node object. Dotted path; a missing step gives undefined,
// which is compared like any other value (and so shows up as a difference rather than a crash).
export function node<Item>(path: string): Rule<Item> {
  const steps = path.split(".");
  return {
    says: path,
    origin: "node",
    from: (item) => {
      let at: unknown = item;
      for (const step of steps) {
        if (at === null || typeof at !== "object") return undefined;
        at = (at as Record<string, unknown>)[step];
      }
      return at;
    },
  };
}

// A value we made. The sentence is what a reviewer checks against the product code; the function is what runs.
export const app = <Item>(says: string, from: (item: Item) => unknown): Rule<Item> => ({
  says,
  origin: "app",
  from,
});

// Builds one object from its slot table. A rule answering ABSENT leaves the key out entirely — which is a
// different response from a key holding null, and the comparison below keeps them different.
export function buildObject<Item>(rules: Record<string, Rule<Item>>, item: Item): unknown {
  const out: Record<string, unknown> = {};
  for (const [slot, rule] of Object.entries(rules)) {
    const value = rule.from(item);
    if (value !== ABSENT) out[slot] = value;
  }
  return out;
}

// ── Paging ───────────────────────────────────────────────────────────────────────
// **A cut list has to say how long the whole list was.** Cutting silently is the defect ⑧ is about, so this
// is the only way a mapping is allowed to cut one: `totalAt` names the slot where the response states the
// full count, and `checkPages` below fails when that slot does not hold it. Leaving it out does not compile.
export type Page<T> = { shown: T[]; total: number; totalAt: string };

export const firstN = <T>(all: readonly T[], n: number, at: { totalAt: string }): Page<T> => ({
  shown: all.slice(0, n),
  total: all.length,
  totalAt: at.totalAt,
});

// ── What a mapping is ────────────────────────────────────────────────────────────
export type Expectation =
  | { ok: true; body: unknown; pages?: readonly Page<unknown>[] }
  /** The trace did not hold what the rules need. Never silently green — the reason is the finding. */
  | { ok: false; why: string };

export type Mapping<Ctx> = {
  /** The openapi schema of the 200 answer, e.g. "ContractsResponse". */
  root: string;
  /** One table per schema the answer can reach. Coverage is judged against this. */
  slots: Record<string, Table>;
  expected: (context: Ctx) => Expectation;
};

// ── Coverage: every slot the contract declares has a rule ────────────────────────
// Without this the mapping could describe six slots of forty and be green. The set of schemas is taken from
// the contract, not listed by hand — a slot added to openapi has nowhere to hide.
type Schema = Record<string, unknown>;

const schemas = openApiDocument.components.schemas as unknown as Record<string, Schema>;

const refName = (value: unknown): string | null => {
  const ref = (value as { $ref?: unknown })?.$ref;
  return typeof ref === "string" && ref.startsWith("#/components/schemas/")
    ? ref.slice("#/components/schemas/".length)
    : null;
};

/** Every schema name the root's answer can reach through `$ref`. */
export function reachableSchemas(root: string): string[] {
  const found = new Set<string>();
  const walk = (name: string) => {
    if (found.has(name)) return;
    found.add(name);
    const seen = new Set<unknown>();
    const scan = (value: unknown) => {
      if (value === null || typeof value !== "object" || seen.has(value)) return;
      seen.add(value);
      const named = refName(value);
      if (named !== null) {
        walk(named);
        return;
      }
      for (const child of Object.values(value as Record<string, unknown>)) scan(child);
    };
    scan(schemas[name] ?? {});
  };
  walk(root);
  return [...found];
}

export type CoverageProblem = { schema: string; slot?: string; message: string };

/** The values of the discriminant that reach one branch, or null when the branch has no constant there. */
const discriminates = (branch: unknown, by: string): string[] | null => {
  const properties = (branch as { properties?: Record<string, unknown> }).properties;
  const slot = properties?.[by] as { const?: unknown; enum?: unknown } | undefined;
  if (slot === undefined) return null;
  if (typeof slot.const === "string") return [slot.const];
  if (Array.isArray(slot.enum) && slot.enum.every((v) => typeof v === "string")) {
    return slot.enum as string[];
  }
  return null;
};

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000");

// Takes the declaration part only, so any mapping can be handed to it whatever its context type.
export function coverage(mapping: {
  root: string;
  slots: Record<string, Table>;
}): CoverageProblem[] {
  const problems: CoverageProblem[] = [];
  for (const name of reachableSchemas(mapping.root)) {
    const schema = schemas[name];
    if (schema === undefined) {
      problems.push({ schema: name, message: "openapi has no such schema" });
      continue;
    }
    const properties = schema.properties as Record<string, unknown> | undefined;
    const union = (schema.anyOf ?? schema.oneOf) as unknown[] | undefined;
    if (properties === undefined && union === undefined) {
      // A string enum, say: no slots, so no rule.
      continue;
    }
    // **A union whose branches are all named or null carries nothing of its own.** `X | null` is the common
    // one: the shape is `X`, which is reached and described under its own name, and `null` has no slots.
    // Only the branches written out inline need a sentence here.
    const inline =
      union === undefined
        ? []
        : union.filter((branch) => {
            const b = branch as { $ref?: unknown; type?: unknown; properties?: unknown };
            return b.$ref === undefined && b.type !== "null" && b.properties !== undefined;
          });
    if (properties === undefined && inline.length === 0) continue;

    const table = mapping.slots[name];
    if (table === undefined) {
      problems.push({
        schema: name,
        message: "the answer can reach this schema and no table describes it",
      });
      continue;
    }
    if (properties !== undefined) {
      if (isBranches(table)) {
        problems.push({ schema: name, message: "one shape, described as a union of branches" });
        continue;
      }
      compareSlots(problems, name, properties, table);
      continue;
    }
    if (!isBranches(table)) {
      problems.push({
        schema: name,
        message:
          "a union of branches, described as one shape — name the slot that tells them apart",
      });
      continue;
    }
    const claimed = new Set<number>();
    for (const [index, branch] of inline.entries()) {
      const values = discriminates(branch, table.by);
      if (values === null) {
        problems.push({
          schema: name,
          message: `branch #${index} holds no constant at '${table.by}', so nothing tells it apart`,
        });
        continue;
      }
      const at = table.of.findIndex((entry) => sameSet(entry.when, values));
      if (at === -1) {
        problems.push({
          schema: name,
          message: `no table for ${table.by} ${values.join("|")}`,
        });
        continue;
      }
      claimed.add(at);
      const branchProperties = (branch as { properties: Record<string, unknown> }).properties;
      compareSlots(
        problems,
        `${name}(${values.join("|")})`,
        branchProperties,
        table.of[at]?.slots ?? {},
      );
    }
    for (const [index, entry] of table.of.entries()) {
      if (!claimed.has(index)) {
        problems.push({
          schema: name,
          message: `a branch for ${table.by} ${entry.when.join("|")} the contract does not declare`,
        });
      }
    }
  }
  return problems;
}

// **Inline shapes are not walked.** Only a schema the contract gives a name to gets a table; an object or a
// union written inline inside one is compared by value (the rule that builds the parent produces the whole
// thing, and `differences` reads every key of it) and validated against the contract by level ②, but no
// sentence is demanded per inline slot. Naming the shape in openapi is what brings it under this rule.
function compareSlots(
  problems: CoverageProblem[],
  where: string,
  properties: Record<string, unknown>,
  table: SlotTable,
): void {
  for (const slot of Object.keys(properties)) {
    if (table[slot] === undefined) problems.push({ schema: where, slot, message: "no rule" });
  }
  for (const slot of Object.keys(table)) {
    if (properties[slot] === undefined) {
      problems.push({
        schema: where,
        slot,
        message: "a rule for a slot the contract does not declare",
      });
    }
  }
}

// ── Comparing ────────────────────────────────────────────────────────────────────
// Only the first few differences are reported — one is enough to see where the drift is, and a report nobody
// reads is the same as no report.
const DIFFERENCES_SHOWN = 6;

const show = (value: unknown): string => {
  if (value === undefined) return "(absent)";
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
};

export function differences(expected: unknown, actual: unknown): string[] {
  const found: string[] = [];
  const walk = (want: unknown, got: unknown, path: string) => {
    if (found.length >= DIFFERENCES_SHOWN) return;
    if (Array.isArray(want) || Array.isArray(got)) {
      if (!Array.isArray(want) || !Array.isArray(got)) {
        found.push(`${path} — expected ${show(want)}, got ${show(got)}`);
        return;
      }
      if (want.length !== got.length) {
        found.push(`${path}.length — expected ${want.length}, got ${got.length}`);
      }
      for (let i = 0; i < Math.max(want.length, got.length); i += 1) {
        walk(want[i], got[i], `${path}[${i}]`);
      }
      return;
    }
    const bothObjects =
      want !== null && got !== null && typeof want === "object" && typeof got === "object";
    if (bothObjects) {
      const w = want as Record<string, unknown>;
      const g = got as Record<string, unknown>;
      // The union of the keys — a key we did not expect is as much a difference as a missing one, and it is
      // the one a schema with `additionalProperties:false` would already have caught, so it must be visible.
      for (const key of new Set([...Object.keys(w), ...Object.keys(g)])) {
        walk(w[key], g[key], path === "" ? key : `${path}.${key}`);
      }
      return;
    }
    if (!Object.is(want, got))
      found.push(`${path || "(root)"} — expected ${show(want)}, got ${show(got)}`);
  };
  walk(expected, actual, "");
  return found;
}

// A mapping that cut a list must have stated the whole count somewhere in the answer it expects.
export function checkPages(expected: unknown, pages: readonly Page<unknown>[]): string[] {
  const problems: string[] = [];
  for (const page of pages) {
    let at: unknown = expected;
    for (const step of page.totalAt.split(".")) {
      at =
        at !== null && typeof at === "object" ? (at as Record<string, unknown>)[step] : undefined;
    }
    if (at !== page.total) {
      problems.push(
        `the mapping cut a list to ${page.shown.length} of ${page.total} but ${page.totalAt} says ${show(at)}`,
      );
    }
  }
  return problems;
}
