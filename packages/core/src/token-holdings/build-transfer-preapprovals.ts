// TransferPreapproval contracts in the ACS -> “Tokens / Preapprovals” screen rows.
//
// A contract by which the receiving side “pre-approves receipt of this currency” — when the sending side
// sees it, it means they can send right away without the offer-accept round trip (the slot of
// TransferPreapproval in the real splice standard). It is the same kind of semantic adapter as buildTokenHoldings and follows
// the same rules: the known template is written in a single constant, there is no visibility re-judgment, and anything
// whose shape is off is not fabricated but left as a problem.
//
// Expiry judgment works the same way as buildTransferOffers — “now” is measured by the caller and passed in
// (asOf). This layer does not read the clock.

import { isRecord } from "../internal/guards.ts";
import { parseTemplateFqn } from "../template-identifier/parse-template-identifier.ts";
import type { HoldingSourceEntry, TokenHoldingProblem } from "./build-token-holdings.ts";

const PREAPPROVAL_TEMPLATE = {
  packageName: "explorer-testdata",
  module: "Explorer",
  entity: "TransferPreapproval",
};

export type TransferPreapprovalExpiry =
  | { passed: true; passedByMs: number }
  | { passed: false; remainingMs: number };

export type TransferPreapprovalRow = {
  contractId: string;
  receiver: string;
  // The server judges and fills this in — so the screen does not compare against my party list again.
  receiverIsViewer: boolean;
  issuer: string;
  instrumentId: string;
  expiresAt: string; // the original ISO string
  expiry: TransferPreapprovalExpiry;
};

export type TransferPreapprovalsView = {
  rows: TransferPreapprovalRow[];
  problems: TokenHoldingProblem[];
};

export type BuildTransferPreapprovalsResult =
  | { kind: "available"; view: TransferPreapprovalsView }
  | { kind: "unavailable"; reason: string };

export function buildTransferPreapprovals(
  entries: unknown,
  asOf: Date | string,
  viewerParties?: readonly string[],
): BuildTransferPreapprovalsResult {
  if (!Array.isArray(entries)) {
    return { kind: "unavailable", reason: "entries_not_array" };
  }
  const asOfDate = new Date(asOf);
  if (Number.isNaN(asOfDate.getTime())) {
    return { kind: "unavailable", reason: "invalid_as_of" };
  }
  const asOfMs = asOfDate.getTime();

  const rows: TransferPreapprovalRow[] = [];
  const problems: TokenHoldingProblem[] = [];
  const viewerSet = new Set(viewerParties ?? []);

  for (const raw of entries) {
    const entry = raw as Partial<HoldingSourceEntry>;
    if (
      typeof entry?.contractId !== "string" ||
      typeof entry?.templateId !== "string" ||
      typeof entry?.packageName !== "string"
    ) {
      return { kind: "unavailable", reason: "malformed_entry" };
    }
    const parsed = parseTemplateFqn(entry.templateId);
    if (!parsed.ok) {
      return { kind: "unavailable", reason: `template_parse_failed:${parsed.reason}` };
    }
    if (
      entry.packageName !== PREAPPROVAL_TEMPLATE.packageName ||
      parsed.module_name !== PREAPPROVAL_TEMPLATE.module ||
      parsed.entity_name !== PREAPPROVAL_TEMPLATE.entity
    ) {
      continue;
    }

    const argument = entry.createArgument;
    if (!isRecord(argument)) {
      problems.push({ contractId: entry.contractId, message: "create_argument_not_record" });
      continue;
    }
    const receiver = argument.receiver;
    const issuer = argument.issuer;
    const currency = argument.currency;
    const expiresAt = argument.expiresAt;
    if (
      typeof receiver !== "string" ||
      typeof issuer !== "string" ||
      typeof currency !== "string" ||
      typeof expiresAt !== "string"
    ) {
      problems.push({ contractId: entry.contractId, message: "payload_shape_mismatch" });
      continue;
    }

    const expiresAtMs = new Date(expiresAt).getTime();
    const expiry: TransferPreapprovalExpiry =
      Number.isNaN(expiresAtMs) || expiresAtMs <= asOfMs
        ? { passed: true, passedByMs: Number.isNaN(expiresAtMs) ? 0 : asOfMs - expiresAtMs }
        : { passed: false, remainingMs: expiresAtMs - asOfMs };

    rows.push({
      contractId: entry.contractId,
      receiver,
      receiverIsViewer: viewerSet.has(receiver),
      issuer,
      instrumentId: currency,
      expiresAt,
      expiry,
    });
  }

  // Mine on top, valid ones above expired ones — arrangement, not judgment.
  rows.sort((a, b) => {
    if (a.receiverIsViewer !== b.receiverIsViewer) return a.receiverIsViewer ? -1 : 1;
    if (a.expiry.passed !== b.expiry.passed) return a.expiry.passed ? 1 : -1;
    if (a.receiver !== b.receiver) return a.receiver < b.receiver ? -1 : 1;
    return a.instrumentId < b.instrumentId ? -1 : a.instrumentId > b.instrumentId ? 1 : 0;
  });

  return { kind: "available", view: { rows, problems } };
}
