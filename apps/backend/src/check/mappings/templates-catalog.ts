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
// means writing a second Daml-LF decoder.
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
import { arr, fqn, rec, str, wildcardAcsPages } from "./read-trace.ts";

// The two branches exist and are named, so that a change to either is reported; every slot inside them is a
// decoded value, so every slot inside them is declined.
const DEFINITION_OK: Record<string, Rule<unknown>> = {
  status: app("ok — the package decoded and it holds this template", () => "ok"),
  packageVersion: unjudged("a package's version is what its bytes decode to"),
  fields: unjudged("a template's fields are what the package bytes decode to"),
  choices: unjudged("a template's choices are what the package bytes decode to"),
  key: unjudged("a template's key is what the package bytes decode to"),
  implements: unjudged("the interfaces a template implements are what the package bytes decode to"),
};
const DEFINITION_UNAVAILABLE: Record<string, Rule<unknown>> = {
  status: app(
    "unavailable — the package did not decode, or it decoded without this template",
    () => "unavailable",
  ),
  reason: unjudged("why the package bytes did not decode, or that they held no such template"),
};
const TEMPLATE_DEFINITION: Branches = {
  by: "status",
  of: [
    { when: ["ok"], slots: DEFINITION_OK },
    { when: ["unavailable"], slots: DEFINITION_UNAVAILABLE },
  ],
};

// Reached through the definition, and every slot of them is decoded — so each is declined as a whole.
const SCHEMA_FIELD: Record<string, Rule<unknown>> = {
  name: unjudged("a field's name is what the package bytes decode to"),
  type: unjudged("a field's type is what the package bytes decode to"),
};
const CHOICE: Record<string, Rule<unknown>> = {
  name: unjudged("a choice's name is what the package bytes decode to"),
  consuming: unjudged("whether a choice consumes is what the package bytes decode to"),
  argType: unjudged("a choice's argument type is what the package bytes decode to"),
  argFields: unjudged("a choice's argument fields are what the package bytes decode to"),
  returnType: unjudged("a choice's return type is what the package bytes decode to"),
};
const SCHEMA_REF: Record<string, Rule<unknown>> = {
  module: unjudged("an implemented interface's module is what the package bytes decode to"),
  name: unjudged("an implemented interface's name is what the package bytes decode to"),
  packageId: unjudged("an implemented interface's package is what the package bytes decode to"),
};

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
  slots: {
    TemplatesResponse: TEMPLATES_RESPONSE,
    TemplateRow: TEMPLATE_ROW,
    TemplateDefinition: TEMPLATE_DEFINITION,
    SchemaFieldLite: SCHEMA_FIELD,
    ChoiceLite: CHOICE,
    SchemaRef: SCHEMA_REF,
  },
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
