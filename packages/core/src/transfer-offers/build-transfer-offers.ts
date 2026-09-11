// Standard interface (TransferInstruction) views -> “Received offers” screen rows.
// Semantic adapter. No visibility re-judgment (the input is assumed to be contracts already in the visible scope);
// this layer does not judge — it carries the view over if present, skips if absent, and leaves an error as a problem.

import { isRecord } from "../internal/guards.ts";
import { interfaceIdsMatch } from "../ledger-request/interface-id-equivalence.ts";

export type TransferOfferRow = {
  contractId: string;
  interfaceId: string;
  sender: string;
  receiver: string;
  amount: string; // the original string as is, not parsed
  instrumentId: unknown; // the id (Text) if a standard InstrumentId record, otherwise the view's value as is
  executeBefore: string; // the original ISO string
  expiry: TransferOfferExpiry;
  // The screen must read this value as is — no recomputation.
  directionInfo: TransferDirectionInfo;
};

// Received/sent judgment relative to the viewer's parties. If viewerParties is not provided, unknown + reason.
export type TransferDirection = "received" | "sent" | "internal" | "third_party" | "unknown";
export type TransferDirectionInfo =
  | { direction: "unknown"; reason: string }
  | { direction: "received" | "sent" | "internal" | "third_party" };

export type TransferOfferExpiry =
  | { passed: true; passedByMs: number }
  | { passed: false; remainingMs: number };

export type TransferOfferProblem = {
  contractId: string;
  interfaceId: string;
  code: number;
  message: string;
  details: unknown[];
};

export type TransferOffersView = {
  rows: TransferOfferRow[];
  problems: TransferOfferProblem[];
};

export type BuildTransferOffersResult =
  | { kind: "available"; view: TransferOffersView }
  | { kind: "unavailable"; reason: string };

// Requires only the minimum fields this function actually uses. Each element of contracts
// has the layer 1 (Ledger API) createdEvent structure (contractId, interfaceViews[]).
type CreatedEventLike = {
  contractId?: unknown;
  interfaceViews?: unknown;
};

// chokepoint: direction judgment happens only in this one function. It is not re-judged at each call site.
function classifyTransferDirection(
  viewerParties: readonly string[] | undefined,
  sender: string,
  receiver: string,
): TransferDirectionInfo {
  if (viewerParties === undefined) {
    return { direction: "unknown", reason: "viewer_parties_not_provided" };
  }
  if (viewerParties.length === 0) {
    return { direction: "unknown", reason: "viewer_parties_empty" };
  }
  const isSender = viewerParties.includes(sender);
  const isReceiver = viewerParties.includes(receiver);
  if (isSender && isReceiver) return { direction: "internal" };
  if (isReceiver) return { direction: "received" };
  if (isSender) return { direction: "sent" };
  return { direction: "third_party" };
}

export function buildTransferOffers(
  contracts: unknown,
  interfaceId: string,
  asOf: Date | string,
  viewerParties?: readonly string[],
): BuildTransferOffersResult {
  if (!Array.isArray(contracts)) {
    return { kind: "unavailable", reason: "contracts_not_array" };
  }

  const asOfDate = new Date(asOf);
  if (Number.isNaN(asOfDate.getTime())) {
    return { kind: "unavailable", reason: "invalid_as_of" };
  }
  const asOfMs = asOfDate.getTime();

  const rows: TransferOfferRow[] = [];
  const problems: TransferOfferProblem[] = [];

  for (const raw of contracts) {
    const entry = raw as CreatedEventLike;
    if (typeof entry?.contractId !== "string" || !Array.isArray(entry.interfaceViews)) {
      // This contract is not a shape we handle — silently skip (treated the same as no view).
      continue;
    }
    const contractId = entry.contractId;

    // No captured sample response contains more than one match for the same interfaceId.
    // Only the first match is used (left as a follow-up review item).
    const view = entry.interfaceViews.find(
      (v) =>
        isRecord(v) &&
        typeof v.interfaceId === "string" &&
        interfaceIdsMatch(v.interfaceId, interfaceId),
    );
    if (!view || !isRecord(view)) {
      // No view for this interface — absorbed into success (0 rows).
      continue;
    }

    const viewStatus = isRecord(view.viewStatus) ? view.viewStatus : {};
    const code = viewStatus.code;

    if (typeof code !== "number" || code !== 0) {
      problems.push({
        contractId,
        interfaceId,
        code: typeof code === "number" ? code : -1,
        message: typeof viewStatus.message === "string" ? viewStatus.message : "",
        details: Array.isArray(viewStatus.details) ? viewStatus.details : [],
      });
      continue;
    }

    const viewValue = isRecord(view.viewValue) ? view.viewValue : {};
    // The Splice token standard's TransferInstructionView puts sender·receiver·amount·instrumentId·executeBefore
    // inside a `transfer` record (Splice.Api.Token.TransferInstructionV1.Transfer). If that record is absent,
    // it is read as a flat view like the old mock standard (ExplorerTokenStandard) — both shapes have actually existed.
    const transfer = isRecord(viewValue.transfer) ? viewValue.transfer : viewValue;
    const sender = transfer.sender;
    const receiver = transfer.receiver;
    const amount = transfer.amount;
    const executeBefore = transfer.executeBefore;
    // The standard's InstrumentId is an { admin, id } record. The name the screen calls it by is id — the same rule as Holdings
    // (label in build-token-holdings). Anything that came as Text (mock standard) stays as is.
    const instrumentRaw = transfer.instrumentId;
    const instrumentId =
      isRecord(instrumentRaw) && typeof instrumentRaw.id === "string"
        ? instrumentRaw.id
        : instrumentRaw;

    if (
      typeof sender !== "string" ||
      typeof receiver !== "string" ||
      typeof amount !== "string" ||
      typeof executeBefore !== "string"
    ) {
      // viewStatus is success (code 0) but the required fields are not in their original form — an untrustworthy value.
      problems.push({
        contractId,
        interfaceId,
        code: 0,
        message: "view_value_shape_mismatch",
        details: [],
      });
      continue;
    }

    const executeBeforeMs = new Date(executeBefore).getTime();
    let expiry: TransferOfferExpiry;
    if (Number.isNaN(executeBeforeMs) || executeBeforeMs <= asOfMs) {
      expiry = {
        passed: true,
        passedByMs: Number.isNaN(executeBeforeMs) ? 0 : asOfMs - executeBeforeMs,
      };
    } else {
      expiry = { passed: false, remainingMs: executeBeforeMs - asOfMs };
    }

    const directionInfo = classifyTransferDirection(viewerParties, sender, receiver);

    rows.push({
      contractId,
      interfaceId,
      sender,
      receiver,
      amount,
      instrumentId,
      executeBefore,
      expiry,
      directionInfo,
    });
  }

  return { kind: "available", view: { rows, problems } };
}
