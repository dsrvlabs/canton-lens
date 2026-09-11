// Turns one Ledger API v2 JSON active contract (createdEvent) into a ContractDetailView that the
// contract detail screen can draw. choices/history are structurally absent from the layer 1 response, so
// only "not_in_this_version" is ever produced. No visibility re-judgment (see docs/development.md, Backend core rules).

import { parseTemplateFqn } from "../template-identifier/parse-template-identifier.ts";
import { explainVisibility, type VisibilityExplanation } from "../visibility/explain-visibility.ts";

// Contracts screen: the structure block holds Synchronizer · reassignmentCounter (Canton-specific
// information with no EVM counterpart) · creation offset (→ link to the creating update point lookup) · contractKey. The four are optional — compatibility with old callers.
export type LedgerAcsEntry = {
  templateId: string;
  packageName: string;
  createArgument: unknown;
  signatories: string[];
  observers: string[];
  witnessParties: string[];
  createdAt: string;
  interfaceViews: unknown[];
  synchronizerId?: string;
  reassignmentCounter?: number;
  offset?: number;
  contractKey?: unknown;
};

export type ContractRenderMode = "generic" | "interface";

export type ContractDetailUnavailable =
  | { kind: "not_in_this_version" }
  | { kind: "fetch_failed"; reason: string };

// contractKey: null in every sample response seen — Daml 3 has no contract keys. It is a third case, neither “not in this version” nor “fetch failed”, so
// it is pinned by a one-line rule: null/undefined is none, a value is kept as is (design decision).
export type ContractKeyView = { kind: "none" } | { kind: "present"; value: unknown };

export type ContractDetailView = {
  templateId: string;
  packageId: string;
  packageName: string;
  module: string;
  entity: string;
  createArgument: unknown;
  signatories: string[];
  observers: string[];
  createdAt: string;
  renderMode: ContractRenderMode;
  interfaceViews: unknown[];
  choices: ContractDetailUnavailable;
  history: ContractDetailUnavailable;
  // Even items outside the product get a slot, stated in words. What has no definition is distinguished from what is simply absent here.
  relatedContracts: ContractDetailUnavailable;
  synchronizerId: string | null;
  reassignmentCounter: number | null;
  // Creation offset — the material for the “creating update” link (update-by-offset point lookup). The ACS does not give an update id.
  createdAtOffset: number | null;
  contractKey: ContractKeyView;
  // “Why I can see this” — not_asked if the viewer parties are not passed.
  visibility: VisibilityExplanation | { status: "not_asked" };
};

export type BuildContractDetailFailure = { ok: false; reason: string };
export type BuildContractDetailSuccess = { ok: true; view: ContractDetailView };
export type BuildContractDetailResult = BuildContractDetailSuccess | BuildContractDetailFailure;

export function buildContractDetail(
  entry: LedgerAcsEntry,
  viewerParties?: readonly string[],
): BuildContractDetailResult {
  const parsed = parseTemplateFqn(entry.templateId);
  if (!parsed.ok) {
    return { ok: false, reason: `templateId parse failed: ${parsed.reason}` };
  }
  const renderMode: ContractRenderMode = entry.interfaceViews.length > 0 ? "interface" : "generic";
  return {
    ok: true,
    view: {
      templateId: entry.templateId,
      packageId: parsed.package_name,
      packageName: entry.packageName,
      module: parsed.module_name,
      entity: parsed.entity_name,
      createArgument: entry.createArgument,
      signatories: entry.signatories,
      observers: entry.observers,
      createdAt: entry.createdAt,
      renderMode,
      interfaceViews: entry.interfaceViews,
      choices: { kind: "not_in_this_version" },
      history: { kind: "not_in_this_version" },
      relatedContracts: { kind: "not_in_this_version" },
      synchronizerId: typeof entry.synchronizerId === "string" ? entry.synchronizerId : null,
      reassignmentCounter:
        typeof entry.reassignmentCounter === "number" ? entry.reassignmentCounter : null,
      createdAtOffset: typeof entry.offset === "number" ? entry.offset : null,
      contractKey:
        entry.contractKey === null || entry.contractKey === undefined
          ? { kind: "none" }
          : { kind: "present", value: entry.contractKey },
      visibility:
        viewerParties === undefined
          ? { status: "not_asked" }
          : // The ACS path delivers stakeholders only — the roles are the two signatory/observer. witness exists only at the event level of the update detail.
            explainVisibility(viewerParties, {
              signatories: entry.signatories,
              observers: entry.observers,
            }),
    },
  };
}
