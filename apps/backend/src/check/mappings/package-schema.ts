// **GET /api/packages/{packageId}/schema, written out again by hand — and this one is mostly an abstention.**
//
// The answer *is* the decoded package: its language version, its name, its modules, its counts. Every one of
// those values is what the bytes decode to, and the only way to state them again is to write a second
// Daml-LF decoder. A check whose expected answer came out of the product's own decoder would be the product
// agreeing with itself, which is the one thing this whole method exists to avoid.
//
// So the decoded payload is declined, once, with its reason — and one abstention covers the whole shape
// beneath it. What is left is still worth stating, and it is the part a caller depends on:
//
//   · **which of the two shapes comes back**, and that "I could not decode this" arrives inside a 200 rather
//     than as a server error — the node is fine, the package is simply not one this version can read;
//   · **that the id in the answer is the id that was asked for**, so a cached or mixed-up package cannot be
//     served under another's name. The schema cache is keyed by package id and is shared across callers,
//     which is safe exactly because a package is its own content hash — and that is the claim this checks.
import {
  app,
  type Branches,
  buildObject,
  type CheckContext,
  type Expectation,
  type Mapping,
  type Rule,
  unjudged,
} from "../mapping.ts";

type Answer = { ctx: CheckContext; packageId: string; reason: string };

const OK: Record<string, Rule<Answer>> = {
  status: app("ok — the package bytes were fetched and decoded", () => "ok"),
  packageId: app(
    "the id the address asked for, which is also the hash of what came back",
    (a) => a.packageId,
  ),
  readAt: app("the instant the check handed the server as its clock", (a) => a.ctx.now.iso),
  lfVersion: unjudged("a package's language version is what its bytes decode to"),
  name: unjudged("a package's name is what its bytes decode to"),
  version: unjudged("a package's version is what its bytes decode to"),
  modules: unjudged("a package's modules are what its bytes decode to"),
  counts: unjudged("the counts are of what its bytes decode to"),
};

const UNAVAILABLE: Record<string, Rule<Answer>> = {
  status: app(
    "unavailable — carried inside a 200. An unsupported language version or a decode failure is a fact about the package, not a fault of the node, and a 502 would say the wrong thing about whose problem it is",
    () => "unavailable",
  ),
  reason: app("which of the two, in this application's own words", (a) => a.reason),
  packageId: app("the id the address asked for", (a) => a.packageId),
  readAt: app("the instant the check handed the server as its clock", (a) => a.ctx.now.iso),
};

const PACKAGE_SCHEMA_RESPONSE: Branches = {
  by: "status",
  of: [
    { when: ["ok"], slots: OK },
    { when: ["unavailable"], slots: UNAVAILABLE },
  ],
};

export const packageSchemaMapping: Mapping<CheckContext> = {
  root: "PackageSchemaResponse",
  slots: { PackageSchemaResponse: PACKAGE_SCHEMA_RESPONSE },
  expected: (ctx): Expectation => {
    const parts = (ctx.url.split("?")[0] ?? "").split("/");
    const packageId = parts[parts.length - 2] ?? "";
    if (!/^[0-9a-f]{64}$/.test(packageId)) {
      return { ok: false, why: "the address does not name a package id" };
    }
    // **The bytes had to come from the node, and they had to come for this id.** If the trace holds no such
    // download the answer cannot have been decoded from anything this check saw, and saying so is the point.
    const fetched = ctx.trace.some(
      (call) => call.method === "GET" && call.path === `/v2/packages/${packageId}`,
    );
    if (!fetched) {
      return {
        ok: false,
        why: `the trace holds no download of ${packageId}, so whatever was decoded did not come from this question`,
      };
    }
    return {
      ok: true,
      pages: [],
      body: buildObject(OK, { ctx, packageId, reason: "" }),
    };
  },
};
