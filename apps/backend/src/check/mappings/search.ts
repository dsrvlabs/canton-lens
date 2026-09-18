// **GET /api/search, written out again by hand.**
//
// **One box, and two honest grades of answer.** There is no index to search: the Ledger API offers none, and
// this application keeps no history of its own. So an id-shaped input gets an exact point lookup and nothing
// else — "similar ids" is not a thing that can exist — while a name-shaped input is matched inside the
// catalogue we already count, which is free and adds no visibility question. There is no full-text search,
// and the answer says so in a slot rather than returning nothing and letting the screen guess.
//
// **A section that does not apply is not an empty section.** not_applicable, ok-with-no-rows and unavailable
// are three different sentences, and keeping them apart is most of what these rules say.
//
// Written by reading router.ts, core/search/classify-search-input.ts and core/search/build-search-results.ts.
import {
  app,
  type Branches,
  buildObject,
  type CheckContext,
  type Expectation,
  type Mapping,
  node,
  type Rule,
  type SlotTable,
} from "../mapping.ts";
import { arr, fqn, ledgerEnd, rec, str, stringsOf, wildcardAcsPages } from "./read-trace.ts";

// ── One hit of each kind ─────────────────────────────────────────────────────────

const UPDATE_HIT: Record<string, Rule<Record<string, unknown>>> = {
  updateId: node("updateId"),
  offset: node("offset"),
  effectiveAt: node("effectiveAt"),
  kind: app("what the point lookup found this update to be", (h) => h.kind),
};

type ContractHit = { contractId: string; templateId: string; packageName: string };

const CONTRACT_HIT: Record<string, Rule<ContractHit>> = {
  contractId: node("contractId"),
  templateId: node("templateId"),
  package: app(
    "the first of the three colon-separated parts of the templateId",
    (c) => fqn(c.templateId)?.[0],
  ),
  module: app("the second of the three parts", (c) => fqn(c.templateId)?.[1]),
  entity: app("the third of the three parts", (c) => fqn(c.templateId)?.[2]),
  packageName: node("packageName"),
};

const PARTY_HIT: Record<string, Rule<{ party: string; contractCount: number }>> = {
  party: node("party"),
  contractCount: app(
    "how many of my contracts that party is a signatory or observer of — what we have between us, not what that party holds",
    (p) => p.contractCount,
  ),
};

const TEMPLATE_HIT: Record<
  string,
  Rule<{ templateId: string; packageName: string; count: number }>
> = {
  templateId: node("templateId"),
  packageId: app(
    "the first of the three colon-separated parts of the templateId",
    (t) => fqn(t.templateId)?.[0],
  ),
  packageName: node("packageName"),
  module: app("the second of the three parts", (t) => fqn(t.templateId)?.[1]),
  entity: app("the third of the three parts", (t) => fqn(t.templateId)?.[2]),
  contractCount: app("how many of my active contracts carry it", (t) => t.count),
};

const PACKAGE_HIT: Record<
  string,
  Rule<{ packageId: string; name: string | null; mine: boolean }>
> = {
  packageId: node("packageId"),
  name: app("the name my own contracts carry for it, or null when none of them do", (p) => p.name),
  inMyContracts: app("whether a template of mine comes from it", (p) => p.mine),
};

// ── A section ────────────────────────────────────────────────────────────────────

const SECTION_UNAVAILABLE: SlotTable = {
  status: app(
    "unavailable — this one lookup failed, while the other sections still answer",
    () => "unavailable",
  ),
  reason: app("why, by name", (s: { reason: string }) => s.reason),
} as SlotTable;

const NOT_APPLICABLE: SlotTable = {
  status: app(
    "not_applicable — this kind of input is not looked up here at all. It is not an empty result: nobody asked",
    () => "not_applicable",
  ),
} as SlotTable;

/** Every section is the same three-way choice; only what a row is differs. */
const sectionOf = (rows: SlotTable): Branches => ({
  by: "status",
  of: [
    { when: ["ok"], slots: rows },
    { when: ["unavailable"], slots: SECTION_UNAVAILABLE },
    { when: ["not_applicable"], slots: NOT_APPLICABLE },
  ],
});

const okRows = <Item>(
  what: string,
  of: Record<string, Rule<Item>>,
): Record<string, Rule<Item[]>> => ({
  status: app(
    "ok — the lookup answered, and these are its rows. No rows is a real answer",
    () => "ok",
  ),
  rows: app(what, (items) => items.map((item) => buildObject(of, item))),
});

const UPDATES_OK = okRows("the one update that id names, or none", UPDATE_HIT);
const CONTRACTS_OK = okRows("the one contract that id names among mine, or none", CONTRACT_HIT);
const PARTIES_OK = okRows("that party, when it appears in any contract of mine", PARTY_HIT);
const TEMPLATES_OK = okRows("the templates of mine whose name matches", TEMPLATE_HIT);
const PACKAGES_OK = okRows("the installed packages whose id or name matches", PACKAGE_HIT);

const notApplicable = (): unknown => buildObject(NOT_APPLICABLE, undefined);

// ── The results, and the answer around them ──────────────────────────────────────

type Results = { q: string; kind: string; contracts: ContractHit[] };

const SEARCH_RESULTS: Record<string, Rule<Results>> = {
  q: app("the text that was typed, echoed as typed", (r) => r.q),
  kind: app(
    "what that text is, by its characters alone: 138 hex is a contract id, 68 an update id, 64 a package id, one '::' a party, three colon-separated pieces a template or interface, a leading '#' a confirmed interface",
    (r) => r.kind,
  ),
  updates: app("not looked up for a contract id", notApplicable),
  contracts: app("the contract that id names, among the ones I can see", (r) =>
    buildObject(CONTRACTS_OK, r.contracts),
  ),
  parties: app("not looked up for a contract id", notApplicable),
  templates: app(
    "not looked up for a contract id — a name search is a different question",
    notApplicable,
  ),
  packages: app("not looked up for a contract id", notApplicable),
  fullText: app(
    "not_available, always — there is no index to run one against, and the answer says so instead of returning nothing",
    () => "not_available",
  ),
};

type Answer = { ctx: CheckContext; end: number; q: string; results: Results };

const CONTRACT_ID_ANSWER: Record<string, Rule<Answer>> = {
  kind: app("contract_id — 138 hexadecimal characters", () => "contract_id"),
  contractId: app("the text that was typed, which is that id", (a) => a.q),
  results: app("the sections", (a) => buildObject(SEARCH_RESULTS, a.results)),
  offset: app("the offset the contracts were read at", (a) => a.end),
  readAt: app("the instant the check handed the server as its clock", (a) => a.ctx.now.iso),
};

// The other seven branches exist and are named so that a change to any of them is reported. Only the one the
// check asks is built; the rest are refused by `expected` rather than guessed at.
const idBranch = (kind: string, slot: string): SlotTable =>
  ({
    kind: app(`${kind}`, () => kind),
    [slot]: app("the text that was typed", (a: Answer) => a.q),
    results: app("the sections", (a: Answer) => buildObject(SEARCH_RESULTS, a.results)),
    offset: app("the offset the contracts were read at", (a: Answer) => a.end),
    readAt: app(
      "the instant the check handed the server as its clock",
      (a: Answer) => a.ctx.now.iso,
    ),
  }) as SlotTable;

const fqnBranch = (kind: string): SlotTable =>
  ({
    kind: app(`${kind}`, () => kind),
    package_name: app(
      "the first of the three colon-separated pieces",
      (a: Answer) => fqn(a.q)?.[0],
    ),
    module_name: app("the second", (a: Answer) => fqn(a.q)?.[1]),
    entity_name: app("the third", (a: Answer) => fqn(a.q)?.[2]),
    results: app("the sections", (a: Answer) => buildObject(SEARCH_RESULTS, a.results)),
    offset: app("the offset the contracts were read at", (a: Answer) => a.end),
    readAt: app(
      "the instant the check handed the server as its clock",
      (a: Answer) => a.ctx.now.iso,
    ),
  }) as SlotTable;

const SEARCH_RESPONSE: Branches = {
  by: "kind",
  of: [
    {
      when: ["empty"],
      slots: {
        kind: app("empty — nothing was typed, and nothing is asked of the node", () => "empty"),
        results: app("the sections, every one of them not_applicable", (a: Answer) =>
          buildObject(SEARCH_RESULTS, a.results),
        ),
        readAt: app(
          "the instant the check handed the server as its clock",
          (a: Answer) => a.ctx.now.iso,
        ),
      } as SlotTable,
    },
    { when: ["contract_id"], slots: CONTRACT_ID_ANSWER as unknown as SlotTable },
    { when: ["update_id"], slots: idBranch("update_id", "updateId") },
    { when: ["party"], slots: idBranch("party", "party") },
    { when: ["package_id"], slots: idBranch("package_id", "packageId") },
    { when: ["interface_id_confirmed"], slots: fqnBranch("interface_id_confirmed") },
    { when: ["template_or_interface_fqn"], slots: fqnBranch("template_or_interface_fqn") },
    { when: ["unrecognized"], slots: idBranch("unrecognized", "reason") },
  ],
};

export const searchMapping: Mapping<CheckContext> = {
  root: "SearchResponse",
  slots: {
    SearchResponse: SEARCH_RESPONSE,
    SearchResults: SEARCH_RESULTS,
    "SearchSection.SearchUpdateHit": sectionOf(UPDATES_OK as SlotTable),
    "SearchSection.SearchContractHit": sectionOf(CONTRACTS_OK as SlotTable),
    "SearchSection.SearchPartyHit": sectionOf(PARTIES_OK as SlotTable),
    "SearchSection.LiveTemplateCatalogRow": sectionOf(TEMPLATES_OK as SlotTable),
    "SearchSection.SearchPackageHit": sectionOf(PACKAGES_OK as SlotTable),
    SearchUpdateHit: UPDATE_HIT,
    SearchContractHit: CONTRACT_HIT,
    SearchPartyHit: PARTY_HIT,
    LiveTemplateCatalogRow: TEMPLATE_HIT,
    SearchPackageHit: PACKAGE_HIT,
  },
  expected: (ctx): Expectation => {
    const q = new URL(ctx.url, "http://check").searchParams.get("q") ?? "";
    // **These rules describe the question the check asks.** The classifier has eight answers and each one
    // gathers different material; the other seven are refused rather than guessed at.
    if (!/^[0-9a-f]{138}$/i.test(q)) {
      return { ok: false, why: "these rules describe a search for a contract id only" };
    }
    const end = ledgerEnd(ctx.trace);
    if (end === null) return { ok: false, why: "the trace holds no ledger end" };
    const pages = wildcardAcsPages(ctx.trace);
    if (pages.length === 0) {
      return { ok: false, why: "the trace holds no unnarrowed active-contracts call" };
    }
    const contracts: ContractHit[] = [];
    for (const page of pages) {
      for (const item of arr(page.answer)) {
        const event = rec(rec(rec(rec(item).contractEntry).JsActiveContract).createdEvent);
        const contractId = str(event.contractId);
        const templateId = str(event.templateId);
        const packageName = str(event.packageName);
        if (contractId === null || templateId === null || packageName === null) {
          return { ok: false, why: "an active-contracts entry is not the shape these rules read" };
        }
        // Exact, and only exact. There is no index behind this box and no "looks similar" to offer.
        if (contractId !== q) continue;
        if (fqn(templateId) === null) continue;
        contracts.push({ contractId, templateId, packageName });
        // The signatories and observers are read for the party search, not this one — named here so the
        // reader can see the same page serves both questions.
        void stringsOf(event.signatories);
      }
    }
    const results: Results = { q, kind: "contract_id", contracts };
    return {
      ok: true,
      pages: [],
      body: buildObject(CONTRACT_ID_ANSWER, { ctx, end, q, results }),
    };
  },
};
