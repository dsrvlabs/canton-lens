// Layer 1 (Ledger API v2 JSON) active contracts response -> contract list screen rows.
// Core rules (see docs/development.md, Backend core rules): reuse parseTemplateFqn, no visibility re-judgment.
//
// List rules for the Contracts screen — this block is the summary:
//   - Columns: template (Entity + packageName, hash collapsed) · contract id · **my role** (signatory / observer — the ACS delivers
//     stakeholders only, so there are two roles, and the material is signatories·observers ∩ my parties; witness exists only at the event level of the update detail) · creation time
//   - **Sorted newest first** (creation offset descending) · keyset paging · filter by template + parties (a single contract, not events, so it passes if that contract matches).
//     Multiple parties use OR: a contract passes when any selected party appears. The material is **appearing parties** (signatories ∪ observers),
//     so it also matches counterparties rather than only the requesting parties.
//     witnessParties is the intersection with the requesting party, so it is deliberately not used here — it never matches on a counterparty's id.
//   - Two kinds of empty result are distinguished: “no visible active contracts” (total 0) ≠ “nothing matched the filter” (matched 0)

import { isStringArray } from "../internal/guards.ts";
import { parseTemplateFqn } from "../template-identifier/parse-template-identifier.ts";
import { explainVisibility, type VisibilityReason } from "../visibility/explain-visibility.ts";

// The fields this function actually uses. offset·witnessParties·packageName are optional for compatibility with old callers — if absent,
// sorting falls back to createdAt, and my role is judged from signatories/observers only.
export type ContractListEntry = {
  contractId: string;
  templateId: string;
  signatories: string[];
  observers: string[];
  createdAt: string;
  offset?: number;
  witnessParties?: string[];
  packageName?: string;
};

export type ContractListRow = {
  contractId: string;
  // In substance this is the packageId (hex). Not the human-readable packageName.
  package: string;
  packageName: string | null;
  module: string;
  entity: string;
  // (signatories ∪ observers) - {viewerParty}. Original order of appearance kept, not sorted.
  counterpartyParty: string[];
  // Roles per my party. The judgment is in one place, explainVisibility.
  myRoles: VisibilityReason[];
  createdAt: string;
  // Creation offset. The value layer 1 gave, as is — the material for the “creating update” link (by-offset point lookup).
  offset: number | null;
};

export type ContractListCursor = { offset: number | null; createdAt: string; contractId: string };

export type ContractListFilter = { template?: string; parties?: string[] };

export type ContractListPage = {
  rows: ContractListRow[];
  nextCursor: ContractListCursor | null;
  // Total count before the filter / count passing the filter — the material for the two kinds of empty result.
  total: number;
  matched: number;
  filter: ContractListFilter;
};

export type ContractListUnavailable = { ok: false; reason: string };

export type BuildContractListResult =
  | { ok: true; page: ContractListPage }
  | ContractListUnavailable;

// The viewer may have several parties — accepts either a single string or a list.
export type ViewerPartyInput = string | readonly string[];

// Newest first: offset descending → createdAt descending → contractId ascending (determinism). Entries without an offset go to the back.
function compareNewestFirst(a: ContractListCursor, b: ContractListCursor): number {
  const ao = a.offset ?? -1;
  const bo = b.offset ?? -1;
  if (ao !== bo) return bo - ao;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.contractId === b.contractId) return 0;
  return a.contractId < b.contractId ? -1 : 1;
}

const cursorOf = (r: {
  offset: number | null;
  createdAt: string;
  contractId: string;
}): ContractListCursor => ({
  offset: r.offset,
  createdAt: r.createdAt,
  contractId: r.contractId,
});

// Reads the template string as one of three: entity · module:entity · pkg:module:entity (the same rule as the Transactions filter).
export function contractMatchesFilter(
  row: { package: string; module: string; entity: string; parties: readonly string[] },
  filter: ContractListFilter,
): boolean {
  if (filter.template) {
    const parts = filter.template.split(":");
    const ok =
      parts.length === 1
        ? row.entity === parts[0]
        : parts.length === 2
          ? row.module === parts[0] && row.entity === parts[1]
          : parts.length === 3
            ? row.package === parts[0] && row.module === parts[1] && row.entity === parts[2]
            : false;
    if (!ok) return false;
  }
  if (filter.parties?.length && !filter.parties.some((party) => row.parties.includes(party)))
    return false;
  return true;
}

export function buildContractList(
  entries: unknown,
  viewerParty: ViewerPartyInput,
  opts?: { pageSize?: number; after?: ContractListCursor; filter?: ContractListFilter },
): BuildContractListResult {
  const viewerList = Array.isArray(viewerParty) ? viewerParty : [viewerParty];
  if (viewerList.length === 0) {
    // An input error, distinct from a failed lookup — an empty party list is not glossed over with 0/[]/null.
    return { ok: false, reason: "empty_viewer_parties" };
  }
  const viewerSet = new Set(viewerList);

  if (!Array.isArray(entries)) {
    // The lookup itself failed (structural anomaly) — unavailable. Not glossed over with 0/[]/null.
    return { ok: false, reason: "acs_entries_not_array" };
  }

  const filter: ContractListFilter = {
    ...(opts?.filter?.template ? { template: opts.filter.template } : {}),
    ...(opts?.filter?.parties?.length ? { parties: Array.from(new Set(opts.filter.parties)) } : {}),
  };

  const all: (ContractListRow & { parties: string[] })[] = [];
  for (const raw of entries) {
    const entry = raw as Partial<ContractListEntry>;
    if (
      typeof entry?.contractId !== "string" ||
      typeof entry?.templateId !== "string" ||
      typeof entry?.createdAt !== "string" ||
      !isStringArray(entry?.signatories) ||
      !isStringArray(entry?.observers) ||
      (entry.witnessParties !== undefined && !isStringArray(entry.witnessParties)) ||
      (entry.offset !== undefined && typeof entry.offset !== "number")
    ) {
      // Structural errors are not partially skipped — so that untrustworthy input is not silently dropped (unavailable).
      return { ok: false, reason: "malformed_entry" };
    }

    const parsed = parseTemplateFqn(entry.templateId);
    if (!parsed.ok) {
      return { ok: false, reason: `template_parse_failed:${parsed.reason}` };
    }

    // chokepoint: the judgment separating me/others happens only in this one filter line.
    const counterpartyParty = Array.from(
      new Set([...entry.signatories, ...entry.observers]),
    ).filter((p) => !viewerSet.has(p));

    // My role — the same judgment function (explainVisibility) also produces the detail's “why I can see this”. The ACS path delivers
    // stakeholders only, so the roles are the two signatory/observer — witness exists only at the event level of the update detail.
    const explained = explainVisibility(viewerList, {
      signatories: entry.signatories,
      observers: entry.observers,
    });

    all.push({
      contractId: entry.contractId,
      package: parsed.package_name,
      packageName: typeof entry.packageName === "string" ? entry.packageName : null,
      module: parsed.module_name,
      entity: parsed.entity_name,
      counterpartyParty,
      myRoles: explained.status === "ok" ? explained.reasons : [],
      createdAt: entry.createdAt,
      offset: typeof entry.offset === "number" ? entry.offset : null,
      parties: Array.from(new Set([...entry.signatories, ...entry.observers])),
    });
  }

  all.sort((a, b) => compareNewestFirst(cursorOf(a), cursorOf(b)));
  const matchedRows = all.filter((r) => contractMatchesFilter(r, filter));

  let startIndex = 0;
  if (opts?.after) {
    const after = opts.after;
    startIndex = matchedRows.findIndex((r) => compareNewestFirst(cursorOf(r), after) > 0);
    if (startIndex === -1) startIndex = matchedRows.length;
  }

  const pageSize = opts?.pageSize ?? 100;
  const pageRows = matchedRows.slice(startIndex, startIndex + pageSize);
  const hasMore = startIndex + pageSize < matchedRows.length;
  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && last ? cursorOf(last) : null;

  return {
    ok: true,
    page: {
      // parties is filter material and is not carried in the row (my role·counterpartyParty are the answer).
      rows: pageRows.map(({ parties: _p, ...row }) => row),
      nextCursor,
      total: all.length,
      matched: matchedRows.length,
      filter,
    },
  };
}
