// Moves fields from the active-contracts ledger response (an array of JsActiveContract, as it really is)
// into the flat structure the core functions require. It makes no judgments (visibility include/exclude
// etc.) — only field selection and renaming.
//
// This field list must stay in sync with the ContractListEntry (contract-list/build-contract-list.ts)
// and LedgerAcsEntry (contract-detail/build-contract-detail.ts) types in packages/core.
// If core changes that field set, this file must be changed with it.

import type {
  ContractListEntry,
  LedgerAcsEntry,
  UpdateEntry,
  UpdateEventEntry,
} from "@canton-lens/core";

export type EnvelopeResult<T> = { ok: true; rows: T[] } | { ok: false; reason: string };

// Treats the point-lookup (update-by-id·update-by-offset) response `{update: {Transaction|Reassignment|…}}` as having the
// same shape as a stream item — buildUpdateDetail reads raw as is, so only the shape is checked here.
export function isGetUpdateResponse(raw: unknown): raw is { update: Record<string, unknown> } {
  return isRecord(raw) && isRecord(raw.update);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractCreatedEvent(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;
  const entry = raw.contractEntry;
  if (!isRecord(entry)) return null;
  const jsActive = entry.JsActiveContract;
  if (!isRecord(jsActive)) return null;
  const createdEvent = jsActive.createdEvent;
  if (!isRecord(createdEvent)) return null;
  return createdEvent;
}

export function toContractListEntries(raw: unknown): EnvelopeResult<ContractListEntry> {
  if (!Array.isArray(raw)) {
    return { ok: false, reason: "active_contracts_not_array" };
  }
  const rows: ContractListEntry[] = [];
  for (const item of raw) {
    const createdEvent = extractCreatedEvent(item);
    if (
      createdEvent === null ||
      typeof createdEvent.contractId !== "string" ||
      typeof createdEvent.templateId !== "string" ||
      typeof createdEvent.createdAt !== "string" ||
      !Array.isArray(createdEvent.signatories) ||
      !Array.isArray(createdEvent.observers)
    ) {
      return { ok: false, reason: "created_event_shape_mismatch" };
    }
    rows.push({
      contractId: createdEvent.contractId,
      templateId: createdEvent.templateId,
      signatories: createdEvent.signatories as string[],
      observers: createdEvent.observers as string[],
      createdAt: createdEvent.createdAt,
      // Material for sorting (newest first)·my role·template labeling — only what is present is copied. Judgment belongs to core.
      ...(typeof createdEvent.offset === "number" ? { offset: createdEvent.offset } : {}),
      ...(Array.isArray(createdEvent.witnessParties)
        ? { witnessParties: createdEvent.witnessParties as string[] }
        : {}),
      ...(typeof createdEvent.packageName === "string"
        ? { packageName: createdEvent.packageName }
        : {}),
    });
  }
  return { ok: true, rows };
}

export type RawCreatedEventRow = {
  contractId: string;
  templateId: string;
  packageName: string;
  createdAt: string;
  signatories: string[];
  observers: string[];
  witnessParties: string[];
  interfaceViews: unknown[];
};

// The flat shape shared by buildTransferOffers·buildTemplateCatalog·(the router's) myPackageIds
// aggregation. Copies the 8 fields as they are — interfaceViews is preserved whole as a shallow
// reference, element internals included, and is not restructured.
export function toRawCreatedEvents(raw: unknown): EnvelopeResult<RawCreatedEventRow> {
  if (!Array.isArray(raw)) {
    return { ok: false, reason: "active_contracts_not_array" };
  }
  const rows: RawCreatedEventRow[] = [];
  for (const item of raw) {
    const createdEvent = extractCreatedEvent(item);
    if (
      createdEvent === null ||
      typeof createdEvent.contractId !== "string" ||
      typeof createdEvent.templateId !== "string" ||
      typeof createdEvent.packageName !== "string" ||
      typeof createdEvent.createdAt !== "string" ||
      !Array.isArray(createdEvent.signatories) ||
      !Array.isArray(createdEvent.observers) ||
      !Array.isArray(createdEvent.witnessParties) ||
      !Array.isArray(createdEvent.interfaceViews)
    ) {
      return { ok: false, reason: "created_event_shape_mismatch" };
    }
    rows.push({
      contractId: createdEvent.contractId,
      templateId: createdEvent.templateId,
      packageName: createdEvent.packageName,
      createdAt: createdEvent.createdAt,
      signatories: createdEvent.signatories as string[],
      observers: createdEvent.observers as string[],
      witnessParties: createdEvent.witnessParties as string[],
      interfaceViews: createdEvent.interfaceViews as unknown[],
    });
  }
  return { ok: true, rows };
}

export function toLedgerAcsEntries(
  raw: unknown,
): EnvelopeResult<{ contractId: string; entry: LedgerAcsEntry }> {
  if (!Array.isArray(raw)) {
    return { ok: false, reason: "active_contracts_not_array" };
  }
  const rows: { contractId: string; entry: LedgerAcsEntry }[] = [];
  for (const item of raw) {
    const createdEvent = extractCreatedEvent(item);
    if (
      createdEvent === null ||
      typeof createdEvent.contractId !== "string" ||
      typeof createdEvent.templateId !== "string" ||
      typeof createdEvent.packageName !== "string" ||
      typeof createdEvent.createdAt !== "string" ||
      !Array.isArray(createdEvent.signatories) ||
      !Array.isArray(createdEvent.observers) ||
      !Array.isArray(createdEvent.witnessParties) ||
      !Array.isArray(createdEvent.interfaceViews)
    ) {
      return { ok: false, reason: "created_event_shape_mismatch" };
    }
    // synchronizerId·reassignmentCounter from the JsActiveContract layer and offset·contractKey from createdEvent — only those present.
    const active = (item as { contractEntry: { JsActiveContract: Record<string, unknown> } })
      .contractEntry.JsActiveContract;
    rows.push({
      contractId: createdEvent.contractId,
      entry: {
        templateId: createdEvent.templateId,
        packageName: createdEvent.packageName,
        createArgument: createdEvent.createArgument,
        signatories: createdEvent.signatories as string[],
        observers: createdEvent.observers as string[],
        witnessParties: createdEvent.witnessParties as string[],
        createdAt: createdEvent.createdAt,
        interfaceViews: createdEvent.interfaceViews as unknown[],
        ...(typeof active.synchronizerId === "string"
          ? { synchronizerId: active.synchronizerId }
          : {}),
        ...(typeof active.reassignmentCounter === "number"
          ? { reassignmentCounter: active.reassignmentCounter }
          : {}),
        ...(typeof createdEvent.offset === "number" ? { offset: createdEvent.offset } : {}),
        ...("contractKey" in createdEvent ? { contractKey: createdEvent.contractKey } : {}),
      },
    });
  }
  return { ok: true, rows };
}

// Moves the updates ledger response (an array of {update:{Transaction:{value}}}) into the flat
// structure buildRecentUpdates receives. Update kinds other than Transaction (Reassignment etc.) are
// not the subject of this screen, so they are skipped — it is a different kind, not a structural error.
// Only the two event kinds CreatedEvent / ArchivedEvent are the subject of this screen; if anything
// else shows up, the whole thing is stopped as a structural mismatch.
export function toUpdateEntries(raw: unknown): EnvelopeResult<UpdateEntry> {
  if (!Array.isArray(raw)) {
    return { ok: false, reason: "updates_not_array" };
  }
  const rows: UpdateEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item) || !isRecord(item.update)) {
      return { ok: false, reason: "update_shape_mismatch" };
    }
    const transaction = item.update.Transaction;
    if (!isRecord(transaction)) continue;
    const value = transaction.value;
    if (
      !isRecord(value) ||
      typeof value.updateId !== "string" ||
      typeof value.offset !== "number" ||
      typeof value.effectiveAt !== "string" ||
      !Array.isArray(value.events)
    ) {
      return { ok: false, reason: "transaction_shape_mismatch" };
    }
    const events: UpdateEventEntry[] = [];
    for (const rawEvent of value.events) {
      if (!isRecord(rawEvent)) {
        return { ok: false, reason: "event_shape_mismatch" };
      }
      const created = rawEvent.CreatedEvent;
      const archived = rawEvent.ArchivedEvent;
      const source = isRecord(created) ? created : isRecord(archived) ? archived : null;
      if (
        source === null ||
        typeof source.contractId !== "string" ||
        typeof source.templateId !== "string"
      ) {
        return { ok: false, reason: "event_shape_mismatch" };
      }
      // “Who is involved in this”. created comes with signatories ∪ observers, while archived has only
      // witnessParties because the ledger does not give those — whichever side is present is copied as is (no judgment).
      const parties = isRecord(created)
        ? Array.from(
            new Set([
              ...(Array.isArray(created.signatories) ? (created.signatories as string[]) : []),
              ...(Array.isArray(created.observers) ? (created.observers as string[]) : []),
            ]),
          )
        : Array.isArray(source.witnessParties)
          ? (source.witnessParties as string[])
          : [];
      events.push({
        kind: isRecord(created) ? "created" : "archived",
        contractId: source.contractId,
        templateId: source.templateId,
        parties,
        // Copied as is — filter judgment is core's share. If it is not an array, the key is not added.
        ...(Array.isArray(source.witnessParties)
          ? { witnessParties: source.witnessParties as string[] }
          : {}),
      });
    }
    rows.push({
      updateId: value.updateId,
      offset: value.offset,
      effectiveAt: value.effectiveAt,
      events,
      // A field that only comes to the submitting party — as is if present, no key if absent.
      ...(typeof value.commandId === "string" ? { commandId: value.commandId } : {}),
    });
  }
  return { ok: true, rows };
}
