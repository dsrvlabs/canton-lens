// Standard Holding interface views -> the **kind count** of the home “my token balances” card.
//
// The home card does not carry an amount total — an exact balance cannot be answered from a single source, so an
// amount on a single card line risks being a lie. Only the kind count is counted; amounts are on the Holdings screen.
//
// **Identification is by the standard Holding interface, not by template name** — the same approach as received offers
// (TransferInstruction). App tokens that do not implement the standard are not caught here, and the screen writes that fact on the card.
// This is a different mechanism from the template adapter of the Holdings screen (buildTokenHoldings).
//
// The basis for the view shape is the Splice token standard `Splice.Api.Token.HoldingV1.HoldingView`
// (owner : Party, instrumentId : InstrumentId { admin : Party, id : Text }, amount : Decimal,
// lock : Optional Lock, meta : Metadata). **No sample response for this view has been captured yet** — because the test standard
// package the fixtures were recorded against has no Holding interface. So the fields this function reads are
// minimized to the two owner·instrumentId, and instrumentId accepts both the standard's record and the test package convention (Text).
// If a view exists but the shape differs, it is not counted and is left as a problem — so as not to fabricate values.
//
// No visibility re-judgment — the input is assumed to already be the viewer's visible scope (ACS) and this layer only counts.

import { isRecord } from "../internal/guards.ts";
import { interfaceIdsMatch } from "../ledger-request/interface-id-equivalence.ts";

export type TokenKindEntry = {
  // The key that separates kinds. The value itself if Text, `admin:id` if a record — the same id with a different issuer is a different kind.
  instrumentKey: string;
  // The name written on the screen. The value itself if Text, id if a record.
  label: string;
  // Preserved as the original — if the screen needs it, it reads admin from here.
  instrumentId: unknown;
  contractCount: number;
};

export type TokenKindProblem = {
  contractId: string;
  interfaceId: string;
  code: number;
  message: string;
};

export type TokenKindsView = {
  // Number of instrument kinds owned by the viewer — the same as instruments.length. The value the card reads.
  count: number;
  instruments: TokenKindEntry[];
  problems: TokenKindProblem[];
};

export type BuildTokenKindsResult =
  | { kind: "available"; view: TokenKindsView }
  | { kind: "unavailable"; reason: string };

// Requires only the minimum fields this function actually uses — contractId·interfaceViews of the layer 1 createdEvent.
type CreatedEventLike = {
  contractId?: unknown;
  interfaceViews?: unknown;
};

function instrumentOf(raw: unknown): { key: string; label: string } | null {
  if (typeof raw === "string") {
    return raw === "" ? null : { key: raw, label: raw };
  }
  if (isRecord(raw) && typeof raw.id === "string" && raw.id !== "") {
    const admin = typeof raw.admin === "string" ? raw.admin : "";
    return { key: admin === "" ? raw.id : `${admin}:${raw.id}`, label: raw.id };
  }
  return null;
}

export function buildTokenKinds(
  contracts: unknown,
  holdingInterfaceId: string,
  viewerParties: readonly string[],
): BuildTokenKindsResult {
  if (!Array.isArray(contracts)) {
    return { kind: "unavailable", reason: "contracts_not_array" };
  }
  if (typeof holdingInterfaceId !== "string" || holdingInterfaceId === "") {
    return { kind: "unavailable", reason: "invalid_interface_id" };
  }
  if (viewerParties.length === 0) {
    // There is no criterion to tell “mine” apart — answering 0 kinds would be a lie.
    return { kind: "unavailable", reason: "viewer_parties_empty" };
  }
  const viewerSet = new Set(viewerParties);

  const kinds = new Map<string, TokenKindEntry>();
  const problems: TokenKindProblem[] = [];

  for (const raw of contracts) {
    const entry = raw as CreatedEventLike;
    if (typeof entry?.contractId !== "string" || !Array.isArray(entry.interfaceViews)) {
      // Not a shape we handle — silently skip, same as no view (the same rule as transfer-offers).
      continue;
    }
    const contractId = entry.contractId;
    const view = entry.interfaceViews.find(
      (v) =>
        isRecord(v) &&
        typeof v.interfaceId === "string" &&
        interfaceIdsMatch(v.interfaceId, holdingInterfaceId),
    );
    if (!view || !isRecord(view)) continue;

    const viewStatus = isRecord(view.viewStatus) ? view.viewStatus : {};
    const code = viewStatus.code;
    if (typeof code !== "number" || code !== 0) {
      problems.push({
        contractId,
        interfaceId: holdingInterfaceId,
        code: typeof code === "number" ? code : -1,
        message: typeof viewStatus.message === "string" ? viewStatus.message : "",
      });
      continue;
    }

    const viewValue = isRecord(view.viewValue) ? view.viewValue : {};
    const owner = viewValue.owner;
    const instrument = instrumentOf(viewValue.instrumentId);
    if (typeof owner !== "string" || instrument === null) {
      // The view succeeded (code 0) but the standard fields are not of that shape — an untrustworthy value, not counted.
      problems.push({
        contractId,
        interfaceId: holdingInterfaceId,
        code: 0,
        message: "view_value_shape_mismatch",
      });
      continue;
    }

    // Someone else's holdings are not added to the kinds — the card is “my tokens”. Not an error, simply not a target.
    if (!viewerSet.has(owner)) continue;

    const existing = kinds.get(instrument.key);
    if (existing === undefined) {
      kinds.set(instrument.key, {
        instrumentKey: instrument.key,
        label: instrument.label,
        instrumentId: viewValue.instrumentId,
        contractCount: 1,
      });
    } else {
      existing.contractCount += 1;
    }
  }

  // Lexicographic by name — this is arrangement, not judgment.
  const instruments = Array.from(kinds.values()).sort((a, b) =>
    a.label < b.label ? -1 : a.label > b.label ? 1 : a.instrumentKey < b.instrumentKey ? -1 : 1,
  );
  return { kind: "available", view: { count: instruments.length, instruments, problems } };
}
