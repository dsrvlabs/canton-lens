// A sibling function on top of the layer 1 (Ledger API GetActiveContracts) response. It uses no stored history and no app-side visibility filter.
//
// This function does not judge visibility. The input is activeContracts already filtered by the participant
// using the requester's ledger token. All it does here is pick out, from within that, the elements where targetParty
// appears as a signatory or observer.
//
// The primary visibility chokepoint is the Canton participant (the point that produced this array), and this function is
// a secondary selection chokepoint that only picks by whether targetParty appears within that result. The screen and API
// use this function's return value as is and do not re-judge.
//
// witnessParties/divulged exist on createdEvent but are not included in this pass condition (signatories∪observers).
// Including them would blur the meaning of "appearing together (counterparty)" and become over-inclusion.

import { isStringArray } from "../internal/guards.ts";

export type ActiveContractEntry = {
  contractEntry: {
    JsActiveContract: {
      createdEvent: {
        contractId: string;
        signatories: readonly string[];
        observers: readonly string[];
        [key: string]: unknown;
      };
      [key: string]: unknown;
    };
  };
  [key: string]: unknown;
};

export type SearchPartyInActiveContractsFound = {
  status: "found";
  scope: "counterparty";
  party: string;
  contractIds: readonly string[];
};

export type SearchPartyInActiveContractsOutOfScope = {
  status: "out_of_scope";
  party: string;
};

export type SearchPartyInActiveContractsInvalidInput = {
  status: "invalid_input";
  detail: string;
};

export type SearchPartyInActiveContractsResult =
  | SearchPartyInActiveContractsFound
  | SearchPartyInActiveContractsOutOfScope
  | SearchPartyInActiveContractsInvalidInput;

function isValidEntry(entry: unknown): entry is ActiveContractEntry {
  if (entry === null || typeof entry !== "object") return false;
  const contractEntry = (entry as Record<string, unknown>).contractEntry;
  if (contractEntry === null || typeof contractEntry !== "object") return false;
  const jsActiveContract = (contractEntry as Record<string, unknown>).JsActiveContract;
  if (jsActiveContract === null || typeof jsActiveContract !== "object") return false;
  const createdEvent = (jsActiveContract as Record<string, unknown>).createdEvent;
  if (createdEvent === null || typeof createdEvent !== "object") return false;
  const ce = createdEvent as Record<string, unknown>;
  if (typeof ce.contractId !== "string") return false;
  if (!isStringArray(ce.signatories)) return false;
  if (!isStringArray(ce.observers)) return false;
  return true;
}

export function searchPartyInActiveContracts(
  activeContracts: unknown,
  targetParty: string,
): SearchPartyInActiveContractsResult {
  if (!Array.isArray(activeContracts)) {
    return { status: "invalid_input", detail: "activeContracts is not an array" };
  }

  // Every element is checked in a full pass; not just some. This is because if a single corrupted element
  // got through, contaminated data could mix into the found result.
  for (let i = 0; i < activeContracts.length; i++) {
    if (!isValidEntry(activeContracts[i])) {
      return {
        status: "invalid_input",
        detail: `element at index ${i} is not a valid createdEvent shape`,
      };
    }
  }

  const validEntries = activeContracts as ActiveContractEntry[];

  const contractIds = validEntries
    .filter((entry) => {
      const ce = entry.contractEntry.JsActiveContract.createdEvent;
      return ce.signatories.includes(targetParty) || ce.observers.includes(targetParty);
    })
    .map((entry) => entry.contractEntry.JsActiveContract.createdEvent.contractId);

  if (contractIds.length === 0) {
    // Why this value does not distinguish "a party that does not exist" from "a party I cannot see": the input is only the
    // requester's active contracts, and the admin API that would ask whether the party exists returns 403 for a user token (measured). We do
    // not pull in an admin token just to refine this one value.
    return { status: "out_of_scope", party: targetParty };
  }

  // scope: "counterparty" is a marker that it is "only what appears together with me, not the whole of that party".
  return { status: "found", scope: "counterparty", party: targetParty, contractIds };
}
