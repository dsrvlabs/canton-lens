// Holding contracts in the ACS -> “Tokens / Holdings” screen groups.
//
// Semantic adapter — the generic screen does not interpret payloads, but this function knows the shape of a token. Two paths:
//   1) **Standard Holding interface views** (opts.holdingInterfaceId) — the same technique as the home card: identify a token by the
//      standard Holding interface view rather than by template name. App tokens that do not implement the standard are not caught, and the screen writes that fact.
//   2) Template adapter (HOLDING_TEMPLATE) — compatibility with the test stack (explorer-testdata). When opts is absent.
// Other templates are not fabricated into tokens here.
//
// Unlike a public-chain token page, “all holders of this token” is not here.
// Since the input is already only the viewer's visible scope (ACS), what this function builds is the balance **visible to me**.
// No visibility re-judgment — the input is assumed to already be the visible scope, and this layer only aggregates and arranges.
//
// A Canton balance is, like UTXO, the sum of several Holding contracts. So for each group, along with the total,
// “how many contracts it consists of” and those contract ids are kept as is — with only the total, the screen has
// no way to drill down to individual contracts.

import { isRecord } from "../internal/guards.ts";
import { interfaceIdsMatch } from "../ledger-request/interface-id-equivalence.ts";
import { parseTemplateFqn } from "../template-identifier/parse-template-identifier.ts";

// **Tokens with round decay** (Tokens screen rule: tokens with round decay, like CC, show that an exact balance is unavailable — neither 0 nor a
// wrong sum is drawn). The material for the judgment is not in layer 1, so it starts as a single constant list in core.
// The Holding template of Splice CC is Splice.Amulet:Amulet (LockedAmulet for locked ones). If other material appears, only this place changes.
export const DECAYING_HOLDING_TEMPLATES: readonly { module: string; entity: string }[] = [
  { module: "Splice.Amulet", entity: "Amulet" },
  { module: "Splice.Amulet", entity: "LockedAmulet" },
];
export function isDecayingHoldingTemplate(templateId: string): boolean {
  const parsed = parseTemplateFqn(templateId);
  if (!parsed.ok) return false;
  return DECAYING_HOLDING_TEMPLATES.some(
    (t) => t.module === parsed.module_name && t.entity === parsed.entity_name,
  );
}

// The only token template the template adapter knows. Keyed by packageName (the human-readable name) —
// packageId (the hash) changes when the DAR is rebuilt, so it cannot be the key.
const HOLDING_TEMPLATE = {
  packageName: "explorer-testdata",
  module: "Explorer",
  entity: "Holding",
};

// Requires only the minimum fields this function actually uses. createArgument (adapter path)·interfaceViews (view path) are what gets interpreted,
// so they are taken as unknown — if the shape differs, it is left as a problem rather than skipped (so as not to fabricate values).
export type HoldingSourceEntry = {
  contractId: string;
  templateId: string;
  packageName: string;
  createArgument?: unknown;
  interfaceViews?: unknown;
};

// One contract making up a balance. This is as far as the values this adapter interprets from the payload go —
// amount·issuer are provided per contract so the screen does not dig through createArgument itself.
export type TokenHoldingContract = {
  contractId: string;
  amount: string; // the original string as is, not parsed
  issuer: string;
};

export type TokenHoldingGroup = {
  instrumentId: string;
  // admin (the issuing registry) if the standard view's instrumentId is a record. null for the Text convention·adapter path.
  instrumentAdmin: string | null;
  owner: string;
  // The server judges and fills this in — so the screen does not compare against my party list again.
  ownerIsViewer: boolean;
  // “Exact balance unavailable” — for decay tokens only the face-value sum is shown, and that fact is stated. The judgment is in one place, isDecayingHoldingTemplate.
  exactBalance: "face_value" | "unavailable_decay";
  // Sum of the original strings. The scale (number of decimal places) follows the longest among the inputs — digits are not fabricated.
  total: string;
  contractCount: number;
  contracts: TokenHoldingContract[];
};

export type TokenHoldingProblem = {
  contractId: string;
  message: string;
};

export type TokenHoldingsView = {
  groups: TokenHoldingGroup[];
  problems: TokenHoldingProblem[];
};

export type BuildTokenHoldingsResult =
  | { kind: "available"; view: TokenHoldingsView }
  | { kind: "unavailable"; reason: string };

// Decimal string addition — converting to float would let "0.1+0.2"-style errors into the balance. Add with BigInt
// after aligning the scales, and the result scale follows the larger of the two inputs.
function parseDecimal(raw: string): { units: bigint; scale: number } | null {
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return null;
  const negative = raw.startsWith("-");
  const body = negative ? raw.slice(1) : raw;
  const [whole = "0", frac = ""] = body.split(".");
  const units = BigInt(whole + frac) * (negative ? -1n : 1n);
  return { units, scale: frac.length };
}

function formatDecimal(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale) || "0";
  const frac = scale > 0 ? `.${digits.slice(digits.length - scale)}` : "";
  return `${negative ? "-" : ""}${whole}${frac}`;
}

function addDecimals(
  a: { units: bigint; scale: number },
  b: { units: bigint; scale: number },
): { units: bigint; scale: number } {
  const scale = Math.max(a.scale, b.scale);
  const au = a.units * 10n ** BigInt(scale - a.scale);
  const bu = b.units * 10n ** BigInt(scale - b.scale);
  return { units: au + bu, scale };
}

// Reads (owner, instrument, amount) from the standard Holding view. The basis for the view shape is the Splice token standard HoldingView
// (owner : Party, instrumentId : InstrumentId { admin, id }, amount : Decimal). instrumentId accepts both the standard's record and the test package
// convention (Text) — the same rule as build-token-kinds. If a view exists but the shape differs, it is a problem (values are not fabricated).
type HoldingFromView =
  | { ok: true; owner: string; key: string; label: string; admin: string | null; amount: string }
  | { ok: false; skip: true }
  | { ok: false; skip?: undefined; message: string };

function holdingFromView(entry: HoldingSourceEntry, holdingInterfaceId: string): HoldingFromView {
  if (!Array.isArray(entry.interfaceViews)) return { ok: false, skip: true };
  const view = entry.interfaceViews.find(
    (v) =>
      isRecord(v) &&
      typeof v.interfaceId === "string" &&
      interfaceIdsMatch(v.interfaceId, holdingInterfaceId),
  );
  if (!isRecord(view)) return { ok: false, skip: true };
  const status = isRecord(view.viewStatus) ? view.viewStatus : {};
  if (status.code !== undefined && status.code !== 0) {
    return { ok: false, message: `view_status:${String(status.code)}` };
  }
  const value = isRecord(view.viewValue) ? view.viewValue : {};
  const owner = value.owner;
  const amount = value.amount;
  const instrument = value.instrumentId;
  let key: string | null = null;
  let label = "";
  let admin: string | null = null;
  if (typeof instrument === "string" && instrument !== "") {
    key = instrument;
    label = instrument;
  } else if (isRecord(instrument) && typeof instrument.id === "string" && instrument.id !== "") {
    admin = typeof instrument.admin === "string" ? instrument.admin : null;
    key = admin === null ? instrument.id : `${admin}:${instrument.id}`;
    label = instrument.id;
  }
  if (typeof owner !== "string" || typeof amount !== "string" || key === null) {
    return { ok: false, message: "holding_view_shape_mismatch" };
  }
  return { ok: true, owner, key, label, admin, amount };
}

export function buildTokenHoldings(
  entries: unknown,
  viewerParties?: readonly string[],
  opts?: { holdingInterfaceId?: string },
): BuildTokenHoldingsResult {
  if (!Array.isArray(entries)) {
    // The lookup itself failed (structural anomaly) — unavailable. Not glossed over with an empty list.
    return { kind: "unavailable", reason: "entries_not_array" };
  }
  const holdingInterfaceId = opts?.holdingInterfaceId;

  const sums = new Map<
    string,
    {
      instrumentId: string;
      instrumentAdmin: string | null;
      owner: string;
      decaying: boolean;
      sum: { units: bigint; scale: number };
      contracts: TokenHoldingContract[];
    }
  >();
  const problems: TokenHoldingProblem[] = [];

  const add = (
    entry: HoldingSourceEntry,
    h: {
      owner: string;
      key: string;
      label: string;
      admin: string | null;
      amount: string;
      issuer: string;
    },
  ) => {
    const decimal = parseDecimal(h.amount);
    if (decimal === null) {
      problems.push({ contractId: entry.contractId, message: `amount_not_decimal:${h.amount}` });
      return;
    }
    const key = `${h.key} ${h.owner}`;
    const contract = { contractId: entry.contractId, amount: h.amount, issuer: h.issuer };
    const decaying = isDecayingHoldingTemplate(entry.templateId);
    const group = sums.get(key);
    if (group === undefined) {
      sums.set(key, {
        instrumentId: h.label,
        instrumentAdmin: h.admin,
        owner: h.owner,
        decaying,
        sum: decimal,
        contracts: [contract],
      });
    } else {
      group.sum = addDecimals(group.sum, decimal);
      group.contracts.push(contract);
      if (decaying) group.decaying = true;
    }
  };

  for (const raw of entries) {
    const entry = raw as Partial<HoldingSourceEntry>;
    if (
      typeof entry?.contractId !== "string" ||
      typeof entry?.templateId !== "string" ||
      typeof entry?.packageName !== "string"
    ) {
      // Structural errors are not partially skipped — so that untrustworthy input is not silently dropped.
      return { kind: "unavailable", reason: "malformed_entry" };
    }
    const parsed = parseTemplateFqn(entry.templateId);
    if (!parsed.ok) {
      return { kind: "unavailable", reason: `template_parse_failed:${parsed.reason}` };
    }

    if (holdingInterfaceId !== undefined) {
      // **Standard interface view path** — contracts without the view are out of scope (app tokens that do not implement the standard). If a view exists but the shape differs, it is a problem.
      const h = holdingFromView(entry as HoldingSourceEntry, holdingInterfaceId);
      if (!h.ok) {
        if (h.skip !== true) problems.push({ contractId: entry.contractId, message: h.message });
        continue;
      }
      add(entry as HoldingSourceEntry, { ...h, issuer: h.admin ?? "" });
      continue;
    }

    // Template adapter path — a template this adapter does not target is not an error, just a different kind. Skip it.
    if (
      entry.packageName !== HOLDING_TEMPLATE.packageName ||
      parsed.module_name !== HOLDING_TEMPLATE.module ||
      parsed.entity_name !== HOLDING_TEMPLATE.entity
    ) {
      continue;
    }
    // From here on it is “a Holding, but the shape differs” — skipping would silently shrink the balance.
    // So it is left as a problem and not added to the total (a short total + a warning rather than a wrong total).
    const argument = entry.createArgument;
    if (!isRecord(argument)) {
      problems.push({ contractId: entry.contractId, message: "create_argument_not_record" });
      continue;
    }
    const owner = argument.owner;
    const currency = argument.currency;
    const amount = argument.amount;
    const issuer = argument.issuer;
    if (
      typeof owner !== "string" ||
      typeof currency !== "string" ||
      typeof amount !== "string" ||
      typeof issuer !== "string"
    ) {
      problems.push({ contractId: entry.contractId, message: "payload_shape_mismatch" });
      continue;
    }
    add(entry as HoldingSourceEntry, {
      owner,
      key: currency,
      label: currency,
      admin: null,
      amount,
      issuer,
    });
  }

  const viewerSet = new Set(viewerParties ?? []);
  const groups: TokenHoldingGroup[] = Array.from(sums.values()).map((g) => ({
    instrumentId: g.instrumentId,
    instrumentAdmin: g.instrumentAdmin,
    owner: g.owner,
    ownerIsViewer: viewerSet.has(g.owner),
    exactBalance: g.decaying ? "unavailable_decay" : "face_value",
    total: formatDecimal(g.sum.units, g.sum.scale),
    contractCount: g.contracts.length,
    contracts: g.contracts,
  }));

  // Mine on top, then lexicographic by owner·instrument — this is arrangement, not judgment.
  groups.sort((a, b) => {
    if (a.ownerIsViewer !== b.ownerIsViewer) return a.ownerIsViewer ? -1 : 1;
    if (a.owner !== b.owner) return a.owner < b.owner ? -1 : 1;
    return a.instrumentId < b.instrumentId ? -1 : a.instrumentId > b.instrumentId ? 1 : 0;
  });

  return { kind: "available", view: { groups, problems } };
}
