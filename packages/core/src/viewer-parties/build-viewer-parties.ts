// buildViewerParties: computes which parties the logged-in user can see with, and what.
//
// The input is an already JSON.parse'd object (file I/O·parsing is the caller's responsibility). This function
// treats it as a "lookup failure" when the shape of the GET /v2/authenticated-user response (user) or the
// GET /v2/users/{id}/rights response (rights) differs from what is expected.
//
// This function only transcribes what is written in rights. It makes no visibility judgment about
// adding or removing any party — which contracts are actually visible is ultimately decided by the participant (Ledger API)
// using the user's real ledger token attached to the request. The returned party set is
// merely the "query candidates" to be carried in filtersByParty.
//
// The stakeholders of __contracts (signatories/observers/witnesses/divulged_only)
// appear nowhere in this function's inputs or outputs and are not its concern.
//
// The scope('own' | 'instance-wide') decision is made only inside this function. Since the return type
// does not expose the original kind/rights, the screen·API only read the scope field
// and have no material with which to re-decide.

import { isRecord } from "../internal/guards.ts";

export type ViewerPartyEntry = {
  party: string;
  kinds: ("CanReadAs" | "CanActAs")[];
};

export type ViewerScope = "own" | "instance-wide";

export type ViewerPartiesView = {
  outcome: "view";
  userId: string;
  primaryParty: string;
  parties: ViewerPartyEntry[];
  scope: ViewerScope;
};

export type ViewerPartiesUnavailable = {
  outcome: "unavailable";
  reason: string;
};

export type BuildViewerPartiesResult = ViewerPartiesView | ViewerPartiesUnavailable;

export function buildViewerParties(user: unknown, rights: unknown): BuildViewerPartiesResult {
  if (!isRecord(user) || !isRecord(user.user)) {
    return {
      outcome: "unavailable",
      reason: "The authenticated-user response has no user object.",
    };
  }
  const u = user.user;
  const id = u.id;
  const primaryParty = u.primaryParty;
  if (typeof id !== "string") {
    return {
      outcome: "unavailable",
      reason: "user.id in the authenticated-user response is not a string.",
    };
  }
  if (typeof primaryParty !== "string") {
    return {
      outcome: "unavailable",
      reason: "user.primaryParty in the authenticated-user response is not a string.",
    };
  }

  if (!isRecord(rights) || !Array.isArray(rights.rights)) {
    return { outcome: "unavailable", reason: "The user-rights response has no rights array." };
  }

  const order: string[] = [];
  const kindsByParty = new Map<string, Set<"CanReadAs" | "CanActAs">>();
  let instanceWide = false;

  for (const item of rights.rights) {
    if (!isRecord(item) || !isRecord(item.kind)) {
      continue;
    }
    const kind = item.kind;
    let matchedPartyKind = false;

    for (const kindName of ["CanReadAs", "CanActAs"] as const) {
      const entry = kind[kindName];
      if (isRecord(entry) && isRecord(entry.value) && typeof entry.value.party === "string") {
        matchedPartyKind = true;
        const party = entry.value.party;
        let set = kindsByParty.get(party);
        if (!set) {
          set = new Set();
          kindsByParty.set(party, set);
          order.push(party);
        }
        set.add(kindName);
      }
    }

    // **Only CanReadAsAnyParty.** ParticipantAdmin used to count here too, and it does not belong: it is a
    // right to administer the participant, not a right to read from it. Measured against Canton 3.5.15 on
    // 2026-09-15 — a user holding ParticipantAdmin and no CanReadAsAnyParty is answered 403 for a request
    // carrying filtersForAnyParty, while the same user with CanReadAsAnyParty is answered 200. The node's
    // own document says as much: CanReadAsAnyParty is "the rights of a participant's super reader", and it
    // is the right named where the API allows a party list to be left out.
    //
    // Counting ParticipantAdmin gave an administrator a scope saying they could read the whole instance
    // and a screen that could show them nothing, since every read they could make would be refused.
    // **The shape is checked, not just the key.** The node's schema gives this right a `value` object, the
    // same as CanReadAs and CanActAs above, so both levels are required. `!== undefined` alone accepted
    // null, false and a bare key; checking only the outer level still accepted `{}` and an array. None is
    // a shape a valid response produces. That was harmless while the scope only chose a badge; it now
    // chooses what the request asks for, so it is read the way the other rights are read.
    if (
      !matchedPartyKind &&
      isRecord(kind.CanReadAsAnyParty) &&
      isRecord(kind.CanReadAsAnyParty.value)
    ) {
      instanceWide = true;
    }
  }

  const parties: ViewerPartyEntry[] = order.map((party) => ({
    party,
    kinds: Array.from(kindsByParty.get(party) ?? []),
  }));

  return {
    outcome: "view",
    userId: id,
    primaryParty,
    parties,
    scope: instanceWide ? "instance-wide" : "own",
  };
}
