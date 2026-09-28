// **GET /api/catalog/templates, written out again by hand.**
//
// The companion to the package catalog, and the opposite of it in the one way that matters: the package list
// is the participant's and the same for everyone, while this one is **built out of my own active contracts**
// — which is why its scope is `visible_to_requester` and why a person the seed left nothing gets an empty
// list here and a full list there. That difference is the product's first principle showing through, so it
// is worth one address each.
//
// Written by reading router.ts, envelope.ts (`toRawCreatedEvents`) and
// core/catalog-live/build-template-catalog.ts.
//
// **The definition of a template is declared unjudged**, for the same reason as the package rows: fields,
// choices, keys and implemented interfaces are what the package bytes decode to, and restating that rule
// means writing a second Daml-LF decoder. One abstention covers the whole shape beneath it, so that is one
// line here rather than fourteen saying the same thing.
import {
  app,
  buildObject,
  type CheckContext,
  type Expectation,
  type Mapping,
  node,
  type Rule,
  unjudged,
} from "../mapping.ts";
import { arr, fqn, rec, str, wildcardAcsPages } from "./read-trace.ts";

type Row = { templateId: string; packageName: string; count: number };

const TEMPLATE_ROW: Record<string, Rule<Row>> = {
  templateId: node("templateId"),
  packageId: app(
    "the first of the three colon-separated parts of the templateId",
    (row) => fqn(row.templateId)?.[0],
  ),
  packageName: app("the packageName the node sent with those contracts", (row) => row.packageName),
  module: app("the second of the three parts", (row) => fqn(row.templateId)?.[1]),
  entity: app("the third of the three parts", (row) => fqn(row.templateId)?.[2]),
  contractCount: app("how many of my active contracts carry this template", (row) => row.count),
  definition: unjudged("a template's definition is what the package bytes decode to"),
};

type Answer = { ctx: CheckContext; rows: Row[] };

const TEMPLATES_RESPONSE: Record<string, Rule<Answer>> = {
  rows: app(
    "one row per template my active contracts carry, the biggest crowd first and the template id breaking a tie",
    (a) => a.rows.map((row) => buildObject(TEMPLATE_ROW, row)),
  ),
  ok: app("true — this answer has no failure shape", () => true),
  scope: app(
    "visible_to_requester — this list is built out of my own contracts, so it is mine and not the participant's",
    () => "visible_to_requester",
  ),
  readAt: app("the instant the check handed the server as its clock", (a) => a.ctx.now.iso),
};

export const templatesCatalogMapping: Mapping<CheckContext> = {
  root: "TemplatesResponse",
  slots: { TemplatesResponse: TEMPLATES_RESPONSE, TemplateRow: TEMPLATE_ROW },
  expected: (ctx): Expectation => {
    const pages = wildcardAcsPages(ctx.trace);
    if (pages.length === 0) {
      return { ok: false, why: "the trace holds no unnarrowed active-contracts call" };
    }
    // **Counted by contract, and a contract only once.** The node keys its answer by contract id, so a
    // contract that arrived twice is still one contract and must not be counted twice.
    const seen = new Map<string, { templateId: string; packageName: string }>();
    for (const page of pages) {
      for (const item of arr(page.answer)) {
        const event = rec(rec(rec(rec(item).contractEntry).JsActiveContract).createdEvent);
        const contractId = str(event.contractId);
        const templateId = str(event.templateId);
        const packageName = str(event.packageName);
        if (contractId === null || templateId === null || packageName === null) {
          return { ok: false, why: "an active-contracts entry is not the shape these rules read" };
        }
        if (fqn(templateId) === null)
          return { ok: false, why: `unparseable template id: ${templateId}` };
        seen.set(contractId, { templateId, packageName });
      }
    }
    const byTemplate = new Map<string, Row>();
    for (const { templateId, packageName } of seen.values()) {
      const row = byTemplate.get(templateId);
      if (row === undefined) byTemplate.set(templateId, { templateId, packageName, count: 1 });
      else row.count += 1;
    }
    const rows = [...byTemplate.values()].sort(
      (a, b) =>
        b.count - a.count ||
        (a.templateId < b.templateId ? -1 : a.templateId > b.templateId ? 1 : 0),
    );
    return { ok: true, pages: [], body: buildObject(TEMPLATES_RESPONSE, { ctx, rows }) };
  },
};
