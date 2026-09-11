// Search results — ids exactly, names within the catalog.
//
// - A single input box; the server determines the type (classifySearchInput). Since there is no index, **honestly in two grades**:
//   id-like inputs (update·contract·party) get **exact-match point lookups only** — “similar ids” are impossible in principle, so they are not promised.
//   name-like inputs (template·interface·package) get **partial matching within my catalog (ACS)** — a list we already count, so it is free and has no visibility issue.
//   There is no full-text search: the Ledger API has no index to run one against.
// - Results are grouped sections by kind: Updates / Contracts / Parties / Templates & Packages. If any lookup fails only that
//   section becomes “could not fetch + reason” — partial failure is not hidden.
//
// The server (core) builds even the results — if the screen assembles per-kind routes, that assembly becomes judgment,
// and judgment made in the browser cannot be tested or held to the same contract as the rest of this layer.
// This function takes the material and only matches·assembles. Ledger calls are made by the caller (router) and passed in.

import type { LiveTemplateCatalogRow } from "../catalog-live/types.ts";
import { isStringArray } from "../internal/guards.ts";
import { parseTemplateFqn } from "../template-identifier/parse-template-identifier.ts";
import type { UpdateDetailView } from "../update-detail/build-update-detail.ts";
import type { SearchInputClassification } from "./classify-search-input.ts";

// Contract material passed by the router — the flat form of the layer 1 createdEvent (the same fields as the envelope RawCreatedEventRow).
export type SearchContractSource = {
  contractId: string;
  templateId: string;
  packageName: string;
  signatories: string[];
  observers: string[];
  witnessParties?: string[];
};

export type SearchUpdateSource =
  | { status: "found"; view: UpdateDetailView }
  | { status: "not_found" | "pruned" | "unavailable"; reason?: string }
  | { status: "not_asked" };

export type BuildSearchResultsInput = {
  q: string;
  classification: SearchInputClassification;
  contracts: readonly SearchContractSource[];
  // The reason if the ACS lookup failed — only the three sections derived from contracts (Contracts·Parties·Templates) become unavailable,
  // and Updates·Packages survive (a partial failure is not escalated to a failure of the whole request).
  contractsUnavailable?: string;
  templates: readonly LiveTemplateCatalogRow[];
  packages:
    | { status: "ok"; packageIds: readonly string[] }
    | { status: "unavailable"; reason: string };
  packageNames: ReadonlyMap<string, string>;
  update: SearchUpdateSource;
};

export type SearchContractHit = {
  contractId: string;
  templateId: string;
  package: string;
  module: string;
  entity: string;
  packageName: string;
};
export type SearchPartyHit = { party: string; contractCount: number };
export type SearchPackageHit = { packageId: string; name: string | null; inMyContracts: boolean };
export type SearchUpdateHit = {
  updateId: string;
  offset: number | null;
  effectiveAt: string | null;
  kind: string;
};

export type SearchSection<T> =
  | { status: "ok"; rows: T[] }
  | { status: "unavailable"; reason: string }
  // This section does not apply to this input shape (e.g. updates are not looked up by party id).
  | { status: "not_applicable" };

export type SearchResults = {
  q: string;
  kind: SearchInputClassification["kind"];
  updates: SearchSection<SearchUpdateHit>;
  contracts: SearchSection<SearchContractHit>;
  parties: SearchSection<SearchPartyHit>;
  templates: SearchSection<LiveTemplateCatalogRow>;
  packages: SearchSection<SearchPackageHit>;
  // There is no full-text search — the screen writes this fact in one line.
  fullText: "not_available";
};

const NOT_APPLICABLE = { status: "not_applicable" } as const;

function contractHit(c: SearchContractSource): SearchContractHit | null {
  const parsed = parseTemplateFqn(c.templateId);
  if (!parsed.ok) return null;
  return {
    contractId: c.contractId,
    templateId: c.templateId,
    package: parsed.package_name,
    module: parsed.module_name,
    entity: parsed.entity_name,
    packageName: c.packageName,
  };
}

function partyCount(contracts: readonly SearchContractSource[], party: string): number {
  let n = 0;
  for (const c of contracts) {
    if (!isStringArray(c.signatories) || !isStringArray(c.observers)) continue;
    if (c.signatories.includes(party) || c.observers.includes(party)) n += 1;
  }
  return n;
}

export function buildSearchResults(input: BuildSearchResultsInput): SearchResults {
  const { classification: k, q } = input;
  const needle = q.trim().toLowerCase();
  const base = { q, kind: k.kind, fullText: "not_available" as const };
  if (k.kind === "empty") {
    return {
      ...base,
      updates: NOT_APPLICABLE,
      contracts: NOT_APPLICABLE,
      parties: NOT_APPLICABLE,
      templates: NOT_APPLICABLE,
      packages: NOT_APPLICABLE,
    };
  }

  // ── Updates — exact match on update id, point lookup result as is ─────────────────────────────────────
  let updates: SearchResults["updates"] = NOT_APPLICABLE;
  if (k.kind === "update_id") {
    const u = input.update;
    if (u.status === "found") {
      const v = u.view;
      updates = {
        status: "ok",
        rows: [
          v.kind === "transaction"
            ? {
                updateId: v.header.updateId,
                offset: v.header.offset,
                effectiveAt: v.header.effectiveAt,
                kind: "transaction",
              }
            : {
                updateId: v.updateId ?? k.updateId,
                offset: v.offset,
                effectiveAt: null,
                kind: v.kind,
              },
        ],
      };
    } else if (u.status === "not_found") {
      updates = { status: "ok", rows: [] };
    } else if (u.status === "not_asked") {
      updates = { status: "unavailable", reason: "not_asked" };
    } else {
      updates = { status: "unavailable", reason: u.reason ?? u.status };
    }
  }

  // ── Contracts — exact match on contract id ─────────────────────────────────────
  const acsDown = input.contractsUnavailable;
  let contracts: SearchResults["contracts"] = NOT_APPLICABLE;
  if (k.kind === "contract_id" && acsDown !== undefined) {
    contracts = { status: "unavailable", reason: acsDown };
  } else if (k.kind === "contract_id") {
    const rows = input.contracts.filter((c) => c.contractId === k.contractId);
    contracts = {
      status: "ok",
      rows: rows.map(contractHit).filter((x): x is SearchContractHit => x !== null),
    };
  }

  // ── Parties — exact match on party id: number of contracts it is involved in together with me ───────────────────────────────────────
  let parties: SearchResults["parties"] = NOT_APPLICABLE;
  if (k.kind === "party" && acsDown !== undefined) {
    parties = { status: "unavailable", reason: acsDown };
  } else if (k.kind === "party") {
    const count = partyCount(input.contracts, k.party);
    parties = {
      status: "ok",
      rows: count > 0 ? [{ party: k.party, contractCount: count }] : [],
    };
  }

  // ── Templates & Packages — name-like inputs match partially within my catalog ────────────────────────────────
  const nameLike =
    k.kind === "template_or_interface_fqn" ||
    k.kind === "interface_id_confirmed" ||
    k.kind === "package_id" ||
    k.kind === "unrecognized";
  let templates: SearchResults["templates"] = NOT_APPLICABLE;
  let packages: SearchResults["packages"] = NOT_APPLICABLE;
  if (nameLike) {
    const rows = input.templates.filter((t) => {
      if (k.kind === "template_or_interface_fqn" || k.kind === "interface_id_confirmed") {
        // If three pieces came, exact match on module·entity (the package piece is a hash and is not used for name search)
        return t.module === k.module_name && t.entity === k.entity_name;
      }
      if (k.kind === "package_id") return t.packageId.toLowerCase() === needle;
      return (
        `${t.module}:${t.entity}`.toLowerCase().includes(needle) ||
        t.packageName.toLowerCase().includes(needle)
      );
    });
    templates =
      acsDown !== undefined ? { status: "unavailable", reason: acsDown } : { status: "ok", rows };

    if (input.packages.status === "unavailable") {
      packages = { status: "unavailable", reason: input.packages.reason };
    } else {
      const mine = new Set(input.templates.map((t) => t.packageId));
      const hits = input.packages.packageIds.filter((id) => {
        const name = input.packageNames.get(id)?.toLowerCase() ?? "";
        if (k.kind === "package_id") return id.toLowerCase() === needle;
        return id.toLowerCase().startsWith(needle) || (name !== "" && name.includes(needle));
      });
      packages = {
        status: "ok",
        rows: hits.map((id) => ({
          packageId: id,
          name: input.packageNames.get(id) ?? null,
          inMyContracts: mine.has(id),
        })),
      };
    }
  }

  return { ...base, updates, contracts, parties, templates, packages };
}
