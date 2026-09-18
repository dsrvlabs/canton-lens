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
  slots: Record<string, SlotTable>;
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

// Takes the declaration part only, so any mapping can be handed to it whatever its context type.
export function coverage(mapping: {
  root: string;
  slots: Record<string, SlotTable>;
}): CoverageProblem[] {
  const problems: CoverageProblem[] = [];
  for (const name of reachableSchemas(mapping.root)) {
    const schema = schemas[name];
    if (schema === undefined) {
      problems.push({ schema: name, message: "openapi has no such schema" });
      continue;
    }
    const properties = schema.properties as Record<string, unknown> | undefined;
    if (properties === undefined) {
      // A union of object branches carries its slots one level down. Saying nothing here would let a whole
      // schema go unmapped in silence, so it is named instead — the mapping form for branches is decided
      // when the first path that needs one arrives.
      if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
        problems.push({
          schema: name,
          message: "a union of branches — this mapping form does not describe branches yet",
        });
      }
      // Anything else (a string enum, say) has no slots and needs no rule.
      continue;
    }
    const table = mapping.slots[name];
    if (table === undefined) {
      problems.push({
        schema: name,
        message: "the answer can reach this schema and no table describes it",
      });
      continue;
    }
    for (const slot of Object.keys(properties)) {
      if (table[slot] === undefined) problems.push({ schema: name, slot, message: "no rule" });
    }
    for (const slot of Object.keys(table)) {
      if (properties[slot] === undefined) {
        problems.push({
          schema: name,
          slot,
          message: "a rule for a slot the contract does not declare",
        });
      }
    }
  }
  return problems;
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
