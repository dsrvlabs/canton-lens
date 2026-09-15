// “Why I see this” — a one-line visibility explanation (a signature feature of this explorer).
//
// The material is only what we already receive: the intersection of the created event's signatories·observers·witnessParties with my party list.
// No new query. It says only in which capacity the match occurred — signatory / observer / or, if neither but present in witnessParties,
// witness (witnessed·divulged). **It does not answer “why can't I see it”** — that what is invisible is not even known to exist is
// Canton's principle, and the screen records that asymmetry in its wording.
//
// Two tiers: the ACS path (contract list·detail) receives only stakeholders, so witnessParties is not passed and there are two capacities,
// while only the update detail (LEDGER_EFFECTS) passes witnessParties, making witness the third capacity.

import { isStringArray } from "../internal/guards.ts";

export type VisibilityRole = "signatory" | "observer" | "witness";

export type VisibilityReason = { party: string; roles: VisibilityRole[] };

export type VisibilityExplanation =
  | { status: "ok"; reasons: VisibilityReason[] }
  // None of my parties appear anywhere — if this contract reached me, the material is lacking (e.g. a response without witnessParties);
  // it is not “not visible”. We say so rather than inventing anything.
  | { status: "no_party_found" }
  // **I hold no party of my own**, so there is no list to intersect and the question does not apply. A
  // super reader (CanReadAsAnyParty) reads as every party and is party to none of them. Distinct from
  // no_party_found, which says a match was looked for and not found — here none could be, and reporting a
  // failed search would read as “the material is lacking” about material that is complete.
  | { status: "no_own_parties" }
  | { status: "unavailable"; reason: string };

export function explainVisibility(
  viewerParties: readonly string[],
  source: { signatories: unknown; observers: unknown; witnessParties?: unknown },
): VisibilityExplanation {
  if (!isStringArray(source.signatories) || !isStringArray(source.observers)) {
    return { status: "unavailable", reason: "stakeholders_not_string_arrays" };
  }
  const witnesses =
    source.witnessParties === undefined
      ? []
      : isStringArray(source.witnessParties)
        ? source.witnessParties
        : null;
  if (witnesses === null)
    return { status: "unavailable", reason: "witness_parties_not_string_array" };

  if (viewerParties.length === 0) return { status: "no_own_parties" };

  const reasons: VisibilityReason[] = [];
  for (const party of viewerParties) {
    const roles: VisibilityRole[] = [];
    if (source.signatories.includes(party)) roles.push("signatory");
    if (source.observers.includes(party)) roles.push("observer");
    if (roles.length === 0 && witnesses.includes(party)) roles.push("witness");
    if (roles.length > 0) reasons.push({ party, roles });
  }
  return reasons.length === 0 ? { status: "no_party_found" } : { status: "ok", reasons };
}
