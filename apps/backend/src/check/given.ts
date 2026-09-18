// **What a person was given, stated rather than worked out.**
//
// Most of the check's questions have no single right answer — they have a right answer *for this person*. A
// viewer holding no party is answered 403 on every party-scoped address, and that 403 is correct; counting it
// as a failure would mean the check can never run as anyone but a fully-provisioned user, which is the one
// user whose answers reveal the least.
//
// **It is declared, never inferred from our own answers.** Deciding "this person sees nothing" because our
// list came back empty would make the answer its own standard, and an application that drops contracts would
// pass every time. The party list is the exception: it comes from the node's own rights response, which is
// the fact itself rather than our reading of it.

/** One party this person holds, and in what capacities — in the order the rights first name them. */
export type ViewerParty = {
  party: string;
  /** "CanReadAs" and "CanActAs", in the order they were first seen for this party. */
  kinds: readonly ("CanReadAs" | "CanActAs")[];
};

export type Given = {
  /**
   * **The whole classification, in order, with the capacities.** It used to be a bare list of party names
   * compared as a set, and two of the people the seed exists to distinguish were then not distinguished at
   * all: one holding two rights on two parties (whose order is the thing being tested) and one holding both
   * capacities on a single party (whose collapse into one entry is the thing being tested).
   */
  parties: readonly ViewerParty[];
  /** CanReadAsAnyParty — reads every party on the participant, and is party to none of them. */
  readsEveryParty: boolean;
  /**
   * Whether the seed left any active contract this person can see. Declared: reading it off our own list
   * would let an application that drops everything agree with itself.
   */
  seesContracts: boolean;
  /**
   * Whether any update in the window this check asks about is visible to them. **Separate from the
   * contracts, because they come from different reads**: the active contracts are a snapshot, the updates are
   * history. A person can hold nothing today and still have archived something yesterday, and one flag for
   * both would then state something false about half the addresses.
   */
  seesUpdates: boolean;
};

/**
 * Whether the node will read anything for this person at all. **Holding no party is not the same as holding
 * no rights** — a super reader holds none of their own and reads every one of them (router.ts:287).
 */
export const canRead = (given: Given): boolean => given.parties.length > 0 || given.readsEveryParty;

/** The party names alone, in order. */
export const partyNames = (given: Given): string[] => given.parties.map((p) => p.party);

const rec = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * Reads a `GET /v2/users/{id}/rights` answer the way the product does: `CanReadAs` and `CanActAs` name a
 * party each and are read identically, the same party twice is one party carrying both capacities, and the
 * order is that of first appearance. `CanReadAsAnyParty` is the only right that widens the scope.
 * `ParticipantAdmin` and `IdentityProviderAdmin` name no party and are not read at all — administering a
 * participant is not a right to read from it, which the node itself agrees with: the account holding
 * ParticipantAdmin on the dev stack is answered 403 to an any-party read (measured 2026-09-18).
 */
export function partiesFromRights(rights: unknown): {
  parties: ViewerParty[];
  readsEveryParty: boolean;
} {
  const order: string[] = [];
  const kindsOf = new Map<string, ("CanReadAs" | "CanActAs")[]>();
  let readsEveryParty = false;
  const isRecord = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);

  for (const item of arr(rec(rights).rights)) {
    const kind = rec(rec(item).kind);
    for (const name of ["CanReadAs", "CanActAs"] as const) {
      const party = rec(rec(kind[name]).value).party;
      if (typeof party !== "string") continue;
      let kinds = kindsOf.get(party);
      if (kinds === undefined) {
        kinds = [];
        kindsOf.set(party, kinds);
        order.push(party);
      }
      if (!kinds.includes(name)) kinds.push(name);
    }
    // Both levels must be a record and neither may be an array — the node sends `{ value: {} }`, and a bare
    // key, a null or an array is not that shape. This right decides what the request asks for, so it is read
    // strictly rather than by the presence of the key.
    const every = kind.CanReadAsAnyParty;
    if (isRecord(every) && isRecord(rec(every).value)) readsEveryParty = true;
  }
  return {
    parties: order.map((party) => ({ party, kinds: kindsOf.get(party) ?? [] })),
    readsEveryParty,
  };
}
