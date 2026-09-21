// **GET /api/catalog/packages, written out again by hand.**
//
// **The one list on this site that is not anybody's.** Every other address answers "what can *I* see"; this
// one answers "what is installed on this participant", and the node's `/v2/packages` gives the same ids to
// everyone — which is why `scope` is the constant `instance_wide` and why a person holding no contracts still
// gets the whole list. What *is* personal is one flag per row: whether my own contracts use that package.
//
// Written by reading router.ts and core/catalog-live/build-package-catalog.ts.
//
// **Six slots are declared unjudged**, and the reason is the same for all six: their values are what the
// package bytes decode to. Restating that rule means writing a second Daml-LF decoder, and a check whose
// expected answer came from the product's own decoder would be comparing the product with itself. What is
// left is still worth stating: which ids the node listed, in what order, and which of them are mine.
import {
  app,
  type Branches,
  buildObject,
  type CheckContext,
  type Expectation,
  type Mapping,
  node,
  type Rule,
  unjudged,
} from "../mapping.ts";
import { answerOf, arr, fqn, rec, str, wildcardAcsPages } from "./read-trace.ts";

const UNAVAILABLE_IN_THIS_LAYER: Record<string, Rule<unknown>> = {
  status: app(
    "unavailable_in_this_layer — the node's package list carries ids and nothing else, so a name it does not carry is said to be missing rather than guessed",
    () => "unavailable_in_this_layer",
  ),
};
const IN_SET: Record<string, Rule<unknown>> = {
  status: app("in_set — a template of mine comes from this package", () => "in_set"),
};
const NOT_IN_SET: Record<string, Rule<unknown>> = {
  status: app("not_in_set — it is installed, but none of my contracts uses it", () => "not_in_set"),
};
const IN_SET_UNKNOWN: Record<string, Rule<unknown>> = {
  status: app("unknown — nobody said which packages are mine", () => "unknown"),
  reason: app(
    "my_package_ids_not_provided — the only way this branch is reached, and this address always says which are mine",
    () => "my_package_ids_not_provided",
  ),
};

const IN_MY_CONTRACTS: Branches = {
  by: "status",
  of: [
    { when: ["in_set"], slots: IN_SET },
    { when: ["not_in_set"], slots: NOT_IN_SET },
    { when: ["unknown"], slots: IN_SET_UNKNOWN },
  ],
};

type Row = { packageId: string; name: string | null };

const PACKAGE_ROW: Record<string, Rule<Row>> = {
  packageId: node("packageId"),
  // The decoded name wins wherever the bytes decode, and only where they do not does the fallback show —
  // the packageName my own contracts carry, or the marker that this layer carries none. Judging the slot
  // means producing the decoded name, so it goes on the unjudged list with the other four.
  name: unjudged("a package's name is what its bytes decode to, except where they do not decode"),
  version: unjudged("a package's version is what its bytes decode to"),
  inMyContracts: app(
    "in_set when a template of mine comes from this package, not_in_set otherwise — the interfaces a contract references do not count, because that is the interface's package and not the contract's own",
    (row) => buildObject(row.name !== null ? IN_SET : NOT_IN_SET, undefined),
  ),
  lfVersion: unjudged("the language version is what the package bytes decode to"),
  schemaStatus: unjudged("whether the bytes could be decoded, and why not when they could not"),
  templates: unjudged("a package's templates are what its bytes decode to"),
  interfaces: unjudged("a package's interfaces are what its bytes decode to"),
};

type Answer = { ctx: CheckContext; rows: Row[] };

const PACKAGES_RESPONSE: Record<string, Rule<Answer>> = {
  rows: app("one row per package id the node listed, sorted by id", (a) =>
    a.rows.map((row) => buildObject(PACKAGE_ROW, row)),
  ),
  ok: app(
    "true — this answer has no failure shape; a node that will not answer becomes an error instead",
    () => true,
  ),
  scope: app(
    "instance_wide — the node's package list is the same for everyone, so there is nothing here to narrow by party",
    () => "instance_wide",
  ),
  readAt: app("the instant the check handed the server as its clock", (a) => a.ctx.now.iso),
};

export const packagesCatalogMapping: Mapping<CheckContext> = {
  root: "PackagesResponse",
  slots: {
    PackagesResponse: PACKAGES_RESPONSE,
    PackageRow: PACKAGE_ROW,
    UnavailableInThisLayer: UNAVAILABLE_IN_THIS_LAYER,
    InMyContractsFlag: IN_MY_CONTRACTS,
  },
  expected: (ctx): Expectation => {
    const listed = rec(answerOf(ctx.trace, "GET", "/v2/packages")).packageIds;
    if (!Array.isArray(listed)) return { ok: false, why: "the trace holds no package list" };
    const acsPages = wildcardAcsPages(ctx.trace);
    if (acsPages.length === 0) {
      return { ok: false, why: "the trace holds no unnarrowed active-contracts call" };
    }
    // The package a contract's own template comes from, and the name that contract carries for it.
    const nameOf = new Map<string, string>();
    for (const page of acsPages) {
      for (const item of arr(page.answer)) {
        const event = rec(rec(rec(rec(item).contractEntry).JsActiveContract).createdEvent);
        const parts = fqn(event.templateId);
        const packageName = str(event.packageName);
        if (parts === null || packageName === null) continue;
        nameOf.set(parts[0], packageName);
      }
    }
    const ids = listed.filter((id): id is string => typeof id === "string");
    if (ids.length !== listed.length) {
      return { ok: false, why: "the node's package list holds something that is not an id" };
    }
    const rows: Row[] = [...ids]
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map((packageId) => ({ packageId, name: nameOf.get(packageId) ?? null }));
    return { ok: true, pages: [], body: buildObject(PACKAGES_RESPONSE, { ctx, rows }) };
  },
};
