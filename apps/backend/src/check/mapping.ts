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
  | "app"
  /** A slot this check declines to state, with the reason written into the sentence. See `unjudged`. */
  | "unjudged";

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

/**
 * **A slot this check cannot state, standing in the expected answer where the value would be.**
 *
 * The whole method is that a person writes down the rule again, independently. For a handful of slots the
 * independent restatement *is* the product: the table of contents of a Daml package is whatever the package
 * bytes decode to, and writing that rule again means writing a second LF decoder. Pretending otherwise would
 * mean copying the product's answer into the expected one and calling the agreement a check.
 *
 * So the abstention is written down instead, with its reason, and `differences` passes over it. It is not
 * silence: a test lists every one of them by name, so adding one is an edit somebody reviews.
 */
export const UNJUDGED = Symbol("unjudged");

export const unjudged = <Item>(why: string): Rule<Item> => ({
  says: `not judged — ${why}`,
  origin: "unjudged",
  from: () => UNJUDGED,
});

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

// ── Which slots anything ever ran over ───────────────────────────────────────────
// **"Every slot has a rule" and "every slot was judged" are different statements**, and only the first was
// being made. A rule sitting under a union branch the recording never produced is a sentence nobody has
// read against anything: it can say whatever it likes. So each table is given the name of the schema it
// describes, and a rule that runs is written down under that name.
//
// What is counted is a rule **running**, not a comparison succeeding. A rule that ran made a value, and that
// value went into the expected answer and was compared slot for slot — so running is what "judged" means
// here, and the comparison's own correctness is a different file's business (differences, below).
const nameOfTable = new WeakMap<object, string>();
const ranOver = new Map<string, number>();

/** Gives every table of a mapping the name of the schema it describes. Idempotent. */
export function nameTables(mapping: { slots: Record<string, Table> }): void {
  for (const [schema, table] of Object.entries(mapping.slots)) {
    if (isBranches(table)) {
      for (const branch of table.of) nameOfTable.set(branch.slots, schema);
    } else {
      nameOfTable.set(table, schema);
    }
  }
}

/** How many times each `schema.slot` rule has run since the counters were last cleared. */
export const slotsRunOver = (): ReadonlyMap<string, number> => new Map(ranOver);
export const forgetSlotsRunOver = (): void => ranOver.clear();

// Builds one object from its slot table. A rule answering ABSENT leaves the key out entirely — which is a
// different response from a key holding null, and the comparison below keeps them different.
export function buildObject<Item>(rules: Record<string, Rule<Item>>, item: Item): unknown {
  const out: Record<string, unknown> = {};
  const schema = nameOfTable.get(rules);
  for (const [slot, rule] of Object.entries(rules)) {
    const value = rule.from(item);
    if (schema !== undefined) {
      const at = `${schema}.${slot}`;
      ranOver.set(at, (ranOver.get(at) ?? 0) + 1);
    }
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

/**
 * The same declaration for a page that does **not** start at the beginning — one asked for with a cursor.
 *
 * `of` has to be given separately because the two numbers are no longer the same one: the rows cut from are
 * the tail after the cursor, while the count the answer states is the whole list. A cursor moves where a page
 * starts; it does not make the rows before it stop existing, and an answer whose total shrank as it was read
 * would tell the screen the list is getting smaller.
 */
export const nFrom = <T>(
  tail: readonly T[],
  n: number,
  at: { of: number; totalAt: string },
): Page<T> => ({
  shown: tail.slice(0, n),
  total: at.of,
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
// A discriminant is usually a string, but not always: one union is told apart by `passed: true` against
// `passed: false`. A branch's values are written as the text of the constant, so `when: ["true"]` names the
// boolean one and reads the same way as every other branch.
const discriminates = (branch: unknown, by: string): string[] | null => {
  const properties = (branch as { properties?: Record<string, unknown> }).properties;
  const slot = properties?.[by] as { const?: unknown; enum?: unknown } | undefined;
  if (slot === undefined) return null;
  const plain = (value: unknown): string | null =>
    typeof value === "string"
      ? value
      : typeof value === "boolean" || typeof value === "number"
        ? String(value)
        : null;
  if (slot.const !== undefined) {
    const one = plain(slot.const);
    return one === null ? null : [one];
  }
  if (Array.isArray(slot.enum)) {
    const all = slot.enum.map(plain);
    return all.every((v): v is string => v !== null) ? all : null;
  }
  return null;
};

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000");

// Takes the declaration part only, so any mapping can be handed to it whatever its context type.
/**
 * **The shapes coverage cannot demand a sentence for.** A slot whose schema is written *inline* in openapi —
 * an object or a union with no name of its own — has no place to hang a table, so no rule is required for
 * the fields inside it. They are still compared (the parent's rule builds the whole value and `differences`
 * reads every key) and still validated (level ②), but "every slot has a hand-written rule" stops being true
 * at that boundary: a new *optional* field could be added inline, never appear in the fixture, and nobody
 * would be asked to write anything.
 *
 * So the boundary is listed instead of assumed. A test pins this list; naming the shape in openapi is what
 * moves it back under the rule.
 */
export function inlineShapes(mapping: { root: string; slots: Record<string, Table> }): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const scan = (where: string, value: unknown, depth: number): void => {
    if (value === null || typeof value !== "object" || depth > 8) return;
    if (refName(value) !== null) return;
    const node = value as Record<string, unknown>;
    const union = (node.anyOf ?? node.oneOf) as unknown[] | undefined;
    // Only a shape that actually carries slots counts. `X | null` and `string[] | null` carry none: the
    // first is a named schema reached under its own name, the second has no fields to write a rule for.
    const unionHasSlots = union?.some(
      (branch) => (branch as { properties?: unknown }).properties !== undefined,
    );
    if (node.properties !== undefined || unionHasSlots) {
      if (!seen.has(where)) {
        seen.add(where);
        found.push(where);
      }
      return;
    }
    if (union !== undefined) {
      for (const [index, branch] of union.entries()) scan(`${where}[${index}]`, branch, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(node)) scan(`${where}.${key}`, child, depth + 1);
  };
  for (const [name, table] of Object.entries(mapping.slots)) {
    const schema = schemas[name];
    if (schema === undefined) continue;
    const branches = table as Branches;
    const tables: [string, SlotTable][] =
      typeof branches.by === "string" && Array.isArray(branches.of)
        ? branches.of.map((entry) => [`${name}(${entry.when.join("|")})`, entry.slots])
        : [[name, table as SlotTable]];
    const shapes: Record<string, unknown>[] = [];
    if (schema.properties !== undefined) shapes.push(schema.properties as Record<string, unknown>);
    for (const branch of ((schema.anyOf ?? schema.oneOf) as unknown[] | undefined) ?? []) {
      const properties = (branch as { properties?: Record<string, unknown> }).properties;
      if (properties !== undefined) shapes.push(properties);
    }
    for (const [where, slots] of tables) {
      for (const properties of shapes) {
        for (const [slot, shape] of Object.entries(properties)) {
          const rule = slots[slot];
          if (rule === undefined || rule.origin === "unjudged") continue;
          scan(`${where}.${slot}`, shape, 0);
        }
      }
    }
  }
  return found.sort();
}

export function coverage(mapping: {
  root: string;
  slots: Record<string, Table>;
}): CoverageProblem[] {
  const problems: CoverageProblem[] = [];
  const done = new Set<string>();

  // The named schemas a property's shape leads to, stopping at each name — what lies inside *that* schema is
  // that schema's own business.
  const refsUnder = (value: unknown, into: Set<string>, seen = new Set<unknown>()): Set<string> => {
    if (value === null || typeof value !== "object" || seen.has(value)) return into;
    seen.add(value);
    const named = refName(value);
    if (named !== null) {
      into.add(named);
      return into;
    }
    for (const child of Object.values(value as Record<string, unknown>))
      refsUnder(child, into, seen);
    return into;
  };

  // **An abstention covers what lies beneath it.** A rule that declines a slot, with its reason, declines
  // the shape under that slot too — demanding a sentence for every field of a decoded package would turn one
  // honest "a second decoder is not a check" into thirty lines that say the same thing less clearly. So the
  // walk simply does not descend through a declined slot.
  const compare = (where: string, properties: Record<string, unknown>, table: SlotTable): void => {
    const next = new Set<string>();
    for (const slot of Object.keys(properties)) {
      const rule = table[slot];
      if (rule === undefined) {
        problems.push({ schema: where, slot, message: "no rule" });
        continue;
      }
      if (rule.origin === "unjudged") continue;
      refsUnder(properties[slot], next);
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
    for (const name of next) visit(name);
  };

  function visit(name: string): void {
    if (done.has(name)) return;
    done.add(name);
    const schema = schemas[name];
    if (schema === undefined) {
      problems.push({ schema: name, message: "openapi has no such schema" });
      return;
    }
    const properties = schema.properties as Record<string, unknown> | undefined;
    const union = (schema.anyOf ?? schema.oneOf) as unknown[] | undefined;
    // **A union whose branches are all named or null carries nothing of its own.** `X | null` is the common
    // one: the shape is `X`, reached and described under its own name, and `null` has no slots. Only the
    // branches written out inline need a sentence here.
    const inline =
      union === undefined
        ? []
        : union.filter((branch) => {
            const b = branch as { $ref?: unknown; type?: unknown; properties?: unknown };
            return b.$ref === undefined && b.type !== "null" && b.properties !== undefined;
          });
    if (properties === undefined && inline.length === 0) {
      // A string enum, say: no slots, so no rule. Named branches are still followed.
      for (const named of refsUnder(union ?? {}, new Set())) visit(named);
      return;
    }
    const table = mapping.slots[name];
    if (table === undefined) {
      problems.push({
        schema: name,
        message: "the answer can reach this schema and no table describes it",
      });
      return;
    }
    if (properties !== undefined) {
      if (isBranches(table)) {
        problems.push({ schema: name, message: "one shape, described as a union of branches" });
        return;
      }
      compare(name, properties, table);
      return;
    }
    if (!isBranches(table)) {
      problems.push({
        schema: name,
        message:
          "a union of branches, described as one shape — name the slot that tells them apart",
      });
      return;
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
        problems.push({ schema: name, message: `no table for ${table.by} ${values.join("|")}` });
        continue;
      }
      claimed.add(at);
      const branchProperties = (branch as { properties: Record<string, unknown> }).properties;
      compare(`${name}(${values.join("|")})`, branchProperties, table.of[at]?.slots ?? {});
    }
    for (const [index, entry] of table.of.entries()) {
      if (!claimed.has(index)) {
        problems.push({
          schema: name,
          message: `a branch for ${table.by} ${entry.when.join("|")} the contract does not declare`,
        });
      }
    }
    // Branches written as a name of their own are followed like any other reference.
    for (const branch of union ?? []) {
      const named = refName(branch);
      if (named !== null) visit(named);
    }
  }

  visit(mapping.root);
  return problems;
}

// **Inline shapes are not walked.** Only a schema the contract gives a name to gets a table; an object or a
// union written inline inside one is compared by value (the rule that builds the parent produces the whole
// thing, and `differences` reads every key of it) and validated against the contract by level ②, but no
// sentence is demanded per inline slot. Naming the shape in openapi is what brings it under this rule.

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
    // A slot whose rule is a declared abstention. Whatever the answer holds there, this check says nothing.
    if (want === UNJUDGED) return;
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
