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
export type Given = {
  /** The parties this person's ledger rights name, in the order the rights list them. */
  parties: readonly string[];
  /** CanReadAsAnyParty — reads every party on the participant, and is party to none of them. */
  readsEveryParty: boolean;
  /**
   * Whether the seed put anything on the ledger this person can see. Declared: it is a fact about the seed,
   * and reading it off our own response is exactly the mistake above.
   */
  seesAnything: boolean;
};

/**
 * Whether the node will read anything for this person at all. **Holding no party is not the same as holding
 * no rights** — a super reader holds none of their own and reads every one of them (router.ts:287).
 */
export const canRead = (given: Given): boolean => given.parties.length > 0 || given.readsEveryParty;

const rec = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * Reads a `GET /v2/users/{id}/rights` answer the way the product does: `CanReadAs` and `CanActAs` name a
 * party each and are read identically, the same party twice is one party, and `CanReadAsAnyParty` is the only
 * right that widens the scope. `ParticipantAdmin` and `IdentityProviderAdmin` name no party and are not read
 * at all — administering a participant is not a right to read from it.
 */
export function partiesFromRights(rights: unknown): {
  parties: string[];
  readsEveryParty: boolean;
} {
  const parties: string[] = [];
  let readsEveryParty = false;
  for (const item of arr(rec(rights).rights)) {
    const kind = rec(rec(item).kind);
    for (const name of ["CanReadAs", "CanActAs"] as const) {
      const party = rec(rec(kind[name]).value).party;
      if (typeof party === "string" && !parties.includes(party)) parties.push(party);
    }
    // Both levels must be a record and neither may be an array — the node sends `{ value: {} }`, and a bare
    // key, a null or an array is not that shape. This right decides what the request asks for, so it is read
    // strictly rather than by the presence of the key.
    const every = kind.CanReadAsAnyParty;
    const value = rec(every).value;
    const isRecord = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);
    if (isRecord(every) && isRecord(value)) readsEveryParty = true;
  }
  return { parties, readsEveryParty };
}
