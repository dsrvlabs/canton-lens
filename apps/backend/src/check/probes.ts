// **Axis ⑤ — asking for something that is not mine.**
//
// Every other level asks "is the answer right for this person". This one asks the question the product's
// first principle turns on: **when I name something I cannot see, does the answer differ in any way from
// naming something that does not exist?** If it does — a different status, a different reason, a different
// shape, an extra field — then the difference is a channel, and the explorer has told me a thing the ledger
// did not: that this id is real.
//
// So the judgement here is not "the answer matches a rule". It is **"these two answers are the same"**, and
// that is why it needs its own pass: nothing that judges one answer at a time can see it.
//
// **The four kinds do not mean the same thing on every address** (2026-09-18 codex), so this is written as a
// matrix rather than one rule applied five times. Measured against the dev participant on 2026-09-18:
//
//   contract detail   mine 200 · another's 404 not_found · absent 404 not_found · archived 404 not_found
//                     — all three collapse, and they must. This reading carries no material to tell
//                       "archived", "never existed" and "not mine" apart, and inventing one would be a lie.
//   update by id      mine 200 · another's 404 not_found · absent 404 not_found
//   update by offset  mine 200 · another's 404 not_found · past the end 404 not_found
//   party detail      mine 200 found · shares nothing 200 out_of_scope · absent 200 out_of_scope
//                     — this address never asks whether a party exists, so those two are the same answer
//                       down to the echoed id, and that is the whole claim.
//   package schema    installed 200 ok, **the same for everyone** · absent 404 not_found
//                     — a package is content-addressed and belongs to nobody; that it does not vary by
//                       person is the claim worth checking here.
import type { Harvest } from "./expectations.ts";
import { canRead, type Given } from "./given.ts";

export type Kind = "mine" | "another's" | "absent" | "archived" | "beyond";

/**
 * What this person can be probed with, recorded beside the tape. **Worked out by asking the node directly**,
 * never from our own answers: "a contract this person cannot see" is precisely the thing our answers would
 * be wrong about if the defect were present.
 */
export type ProbeMaterial = {
  /** A contract somebody else can see and this person cannot. `null` when they see everything. */
  unseenContractId: string | null;
  /** An update likewise, and the offset it sits at. */
  unseenUpdateId: string | null;
  unseenOffset: number | null;
  /** A contract this person watched being created and then archived — gone from the active contracts. */
  archivedContractId: string | null;
  /** A party that exists and shares no contract with this person. */
  unseenParty: string | null;
};

export const NO_PROBES: ProbeMaterial = {
  unseenContractId: null,
  unseenUpdateId: null,
  unseenOffset: null,
  archivedContractId: null,
  unseenParty: null,
};

// **Ids that are well formed and name nothing.** Each passes the shape its address requires, so the refusal
// comes from the ledger having no such thing and not from this application rejecting the text — which is a
// different answer and would compare as a difference.
const ABSENT_CONTRACT = `00${"ab".repeat(68)}`.slice(0, 138);
/** `1220` + 64 hex is the real shape of an update id — the multihash prefix plus a sha2-256. */
const ABSENT_UPDATE = `1220${"cd".repeat(32)}`;
const ABSENT_PACKAGE = "ef".repeat(32);
const ABSENT_PARTY = `nobody-at-all::1220${"ab".repeat(32)}`;
/** Far past any ledger this check runs against. Fixed, so the question is the same every time. */
const BEYOND_OFFSET = 9_000_000;

export type ProbeSpec = {
  /** The openapi template being probed. */
  template: string;
  /** The kinds this address is asked with, and the order they are asked in. */
  kinds: readonly Kind[];
  /** The address for one kind, or null when this person has no such thing to name. */
  url: (kind: Kind, harvested: Harvest, material: ProbeMaterial) => string | null;
  /**
   * What the address answers for that kind, **to this person**: the HTTP status, and the word inside the
   * body that names it. A viewer with no reading scope never gets as far as the address looking (see
   * `REFUSED` below), so that case is handled once for every path rather than five times.
   */
  says: (kind: Kind, given: Given) => { status: number; reason?: string; bodySays?: string };
  /**
   * The kinds whose **whole answer** must be identical. This is the leak check: any difference between them
   * is this application telling the caller something the ledger did not.
   */
  identical: readonly Kind[];
  /** Slots that differ between those answers by construction — the echoed id, and nothing else. */
  ignoring?: readonly string[];
  /**
   * True when **the same address must give every person the same answer**. Only one does: a package is its
   * own content hash and belongs to nobody, so an answer that varied by person would mean this application
   * had attached a person to something that has none.
   */
  sameForEveryone?: boolean;
};

const q = encodeURIComponent;

const NOT_FOUND = { status: 404, reason: "not_found" };

/**
 * **A viewer holding no reading scope never reaches the address.** They are refused at the door, and the
 * refusal is the same one whatever they named — which is the same claim this axis makes one level down, and
 * the reason it is stated here rather than treated as an exception.
 */
const refusedOutright = (given: Given): { status: number; reason: string } | null =>
  canRead(given) ? null : { status: 403, reason: "no_party_rights" };

export const PROBES: readonly ProbeSpec[] = [
  {
    template: "/api/contracts/{contractId}",
    kinds: ["mine", "another's", "absent", "archived"],
    url: (kind, h, m) => {
      const id =
        kind === "mine"
          ? h.contractId
          : kind === "another's"
            ? m.unseenContractId
            : kind === "archived"
              ? m.archivedContractId
              : ABSENT_CONTRACT;
      return id === null ? null : `/api/contracts/${q(id)}`;
    },
    says: (kind, given) =>
      refusedOutright(given) ?? (kind === "mine" ? { status: 200 } : NOT_FOUND),
    // **The one place in this application where four situations give one answer, on purpose.** The active
    // contracts carry no material to tell them apart, and any attempt would be an invention.
    identical: ["another's", "absent", "archived"],
  },
  {
    template: "/api/updates/{updateId}",
    kinds: ["mine", "another's", "absent"],
    url: (kind, h, m) => {
      const id =
        kind === "mine" ? h.updateId : kind === "another's" ? m.unseenUpdateId : ABSENT_UPDATE;
      return id === null ? null : `/api/updates/${q(id)}`;
    },
    says: (kind, given) =>
      refusedOutright(given) ?? (kind === "mine" ? { status: 200 } : NOT_FOUND),
    identical: ["another's", "absent"],
  },
  {
    template: "/api/updates/by-offset/{offset}",
    kinds: ["mine", "another's", "beyond"],
    url: (kind, h, m) => {
      const at = kind === "mine" ? h.offset : kind === "another's" ? m.unseenOffset : BEYOND_OFFSET;
      return at === null ? null : `/api/updates/by-offset/${at}`;
    },
    // An offset past the end is not a malformed request — it is a point that has not happened. Measured: the
    // node answers not found rather than "after the ledger end", which only the list paths' `?offset=` sees.
    says: (kind, given) =>
      refusedOutright(given) ?? (kind === "mine" ? { status: 200 } : NOT_FOUND),
    identical: ["another's", "beyond"],
  },
  {
    template: "/api/party/{partyId}",
    kinds: ["mine", "another's", "absent"],
    url: (kind, h, m) => {
      const party =
        kind === "mine" ? h.partyId : kind === "another's" ? m.unseenParty : ABSENT_PARTY;
      return party === null ? null : `/api/party/${q(party)}`;
    },
    // **This address never asks whether a party exists**, and the answer says so: out_of_scope means none of
    // my contracts names it, not that it is unknown. So an existing stranger and an invented id are one
    // answer, and the only difference allowed is the id echoed back.
    says: (kind, given) =>
      refusedOutright(given) ??
      (kind === "mine" && given.seesContracts
        ? { status: 200, bodySays: "found" }
        : // **My own party is found among my own contracts exactly when I have any.** A person the seed left
          // nothing gets out_of_scope for their own id, and that is right: the answer is about what we have
          // between us, and we have nothing.
          { status: 200, bodySays: "out_of_scope" }),
    identical: ["another's", "absent"],
    ignoring: ["party"],
  },
  {
    template: "/api/packages/{packageId}/schema",
    kinds: ["mine", "absent"],
    url: (kind, h) => {
      const id = kind === "mine" ? h.packageId : ABSENT_PACKAGE;
      return id === null ? null : `/api/packages/${id}/schema`;
    },
    // **No viewer is resolved on this address at all**, so even a person with no reading scope is answered
    // by the package rather than refused — which is the same statement as `scope: instance_wide` on the
    // catalogue, made where it can be checked.
    says: (kind) => (kind === "mine" ? { status: 200 } : NOT_FOUND),
    // Nothing collapses within one person here: a package belongs to nobody, so there is no "not mine" to be confused with
    // "not there". What is checked across people instead is that the answer does not vary by person.
    identical: [],
    // A package is content-addressed: it is the same bytes whoever asks, and it belongs to nobody. So the
    // claim worth checking is across people rather than across kinds.
    sameForEveryone: true,
  },
];

/** Why this person cannot be asked this kind at this address. Said from what they *are*, never guessed. */
export function whyNoProbe(kind: Kind, given: Given): string {
  if (kind === "mine") {
    return canRead(given)
      ? "the earlier answers named nothing of this kind"
      : "holds no reading scope, so the earlier answers named nothing";
  }
  if (kind === "another's") {
    // **A super reader has no "another's".** They read every party on the participant, so there is nothing
    // here that is somebody else's — and that is a fact about the right, not a gap in the recording.
    return given.readsEveryParty
      ? "this person reads every party, so nothing on this participant is another's"
      : "nothing outside this person's sight was recorded to name";
  }
  if (kind === "archived") {
    return "the seed archived nothing this person could see";
  }
  return "no such address could be built";
}

/**
 * What differs between two answers, ignoring the slots that differ by construction.
 *
 * Deliberately shallow-but-total: the two bodies are compared whole, as text, after the ignored slots are
 * removed. A difference anywhere — an extra key, a different reason, a number that is not the same — is the
 * finding, and describing *where* matters less than that there is one.
 */
export function answerDifference(
  a: { status: number; body: unknown },
  b: { status: number; body: unknown },
  ignoring: readonly string[],
): string | null {
  if (a.status !== b.status) return `one answered ${a.status} and the other ${b.status}`;
  // `readAt` is the instant the answer was built, and two answers are built one after the other — against a
  // real participant those instants differ by a millisecond or two and mean nothing. It is the only slot
  // dropped without being named by the address, and it is dropped everywhere.
  const strip = (value: unknown): unknown => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [key, at] of Object.entries(value as Record<string, unknown>)) {
      if (key === "readAt" || ignoring.includes(key)) continue;
      out[key] = at;
    }
    return out;
  };
  const left = JSON.stringify(strip(a.body));
  const right = JSON.stringify(strip(b.body));
  return left === right ? null : `the bodies differ — ${left} against ${right}`;
}
