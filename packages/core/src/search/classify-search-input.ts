// A pure function that tells what a single piece of text typed into the search box is.
// Background: templateId and interfaceId have the same shape (both are 64-char hash:module:entity) —
// therefore, for a three-piece text starting with a hash, it only answers that it may be either a template or an interface.
// Only the notation starting with "#" is confirmed as an interface (that notation is not used for templates).
//
// The three-piece (hash:module:entity) decomposition is not reimplemented; the existing chokepoint
// parseTemplateFqn (template-identifier/parse-template-identifier.ts) is called as is.
//
// The classification order is pinned literally in the frozen design. Since the shapes are mutually exclusive, changing the order
// should in theory give the same result, but the "#" check is placed first so that the confirmed notation is not absorbed
// into another branch.

import { parseTemplateFqn } from "../template-identifier/parse-template-identifier.ts";

export type SearchInputClassification =
  | { kind: "empty" }
  | { kind: "contract_id"; contractId: string }
  // An update id is a 68-char hash ("1220" + 64) — separated from contract id (138)·package id (64) by length (search rule: id-like inputs get exact-match point lookups).
  | { kind: "update_id"; updateId: string }
  | { kind: "party"; party: string }
  | { kind: "package_id"; packageId: string }
  | {
      kind: "interface_id_confirmed";
      package_name: string;
      module_name: string;
      entity_name: string;
    }
  | {
      kind: "template_or_interface_fqn";
      package_name: string;
      module_name: string;
      entity_name: string;
    }
  | { kind: "unrecognized"; reason: string };

const CONTRACT_ID_RE = /^[0-9a-f]{138}$/i;
const UPDATE_ID_RE = /^[0-9a-f]{68}$/i;
const PACKAGE_ID_RE = /^[0-9a-f]{64}$/i;

function looksLikeParty(input: string): boolean {
  // Exactly one "::", neither side empty (name::hash shape).
  const idx = input.indexOf("::");
  if (idx <= 0) return false;
  if (idx !== input.lastIndexOf("::")) return false; // two or more "::" is not a party shape
  const before = input.slice(0, idx);
  const after = input.slice(idx + 2);
  if (before === "" || after === "") return false;
  // That there is no further "::" piece after the "::" was already checked above.
  return true;
}

export function classifySearchInput(input: string): SearchInputClassification {
  if (input === "") {
    return { kind: "empty" };
  }

  if (input.startsWith("#")) {
    const rest = input.slice(1);
    const parsed = parseTemplateFqn(rest);
    if (parsed.ok) {
      return {
        kind: "interface_id_confirmed",
        package_name: parsed.package_name,
        module_name: parsed.module_name,
        entity_name: parsed.entity_name,
      };
    }
    return { kind: "unrecognized", reason: "malformed_interface_tag" };
  }

  if (CONTRACT_ID_RE.test(input)) {
    return { kind: "contract_id", contractId: input };
  }

  if (UPDATE_ID_RE.test(input)) {
    return { kind: "update_id", updateId: input };
  }

  if (PACKAGE_ID_RE.test(input)) {
    return { kind: "package_id", packageId: input };
  }

  if (looksLikeParty(input)) {
    return { kind: "party", party: input };
  }

  const parsed = parseTemplateFqn(input);
  if (parsed.ok) {
    return {
      kind: "template_or_interface_fqn",
      package_name: parsed.package_name,
      module_name: parsed.module_name,
      entity_name: parsed.entity_name,
    };
  }

  return { kind: "unrecognized", reason: "no_shape_matched" };
}
