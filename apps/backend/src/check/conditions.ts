// **What the recording has to contain for the rules to bite.**
//
// Every level above judges an answer against a rule. None of them can tell the difference between a rule that
// held and a rule that was never reached: a sentence about decaying tokens is agreed with perfectly by a
// ledger that issues none. Phase 4 found eight such sentences by mutation — break the product, nothing goes
// red — and each was written down beside the rule as a data condition the seed owed. Written down in a
// comment, they rot: the seed changes, nobody reads the comment, and the check goes on being green about
// nothing.
//
// So they are stated here as **claims about the material**, and a claim nothing satisfies is a finding. This
// is not a judgement about the product — the product may be perfect while the recording is thin — which is
// why it is its own level (⑥) and says what it says: *this rule is no longer being exercised*.
//
// **A condition is shown by an answer, never by the seed script.** Reading it from the dev stack's setup
// would make the check agree with the thing that produced it; reading it from our own answer means the
// material actually travelled the whole path, node to rule, and arrived.
import type { Given } from "./given.ts";
import type { NodeCall } from "./trace.ts";

/** One answer, as it was seen: who asked, what they were given, what came back and what the node was asked. */
export type Sighting = {
  user: string;
  given: Given;
  /** The check table's name for the address (`/api/contracts?pageSize=2`), not the URL asked. */
  label: string;
  url: string;
  body: unknown;
  trace: readonly NodeCall[];
};

export type Condition = {
  /** What the material must contain, in the words the seed would have to satisfy. */
  name: string;
  /** The rule it keeps alive. Take the material away and this sentence is agreed with by an empty set. */
  keeps: string;
  /** True when this one answer shows it. */
  shown: (seen: Sighting) => boolean;
};

/**
 * A condition that **cannot** be met here, and why. Declared rather than left off the list: the difference
 * between "the seed owes this" and "no seed could give it" is the whole reason a reader would look, and an
 * absence with no sentence beside it reads as an oversight either way.
 *
 * Pinned by a listing test, exactly as `unjudged` is — an entry removed silently would take a rule's last
 * account of itself with it.
 */
export type OutOfReach = { name: string; keeps: string; why: string };

const rec = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** Every object anywhere inside a value, the value itself included. Used to find one row in a whole answer. */
function* everyRecord(value: unknown): Generator<Record<string, unknown>> {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) yield* everyRecord(item);
    return;
  }
  yield value as Record<string, unknown>;
  for (const item of Object.values(value as Record<string, unknown>)) yield* everyRecord(item);
}

const at = (label: string, seen: Sighting) => seen.label === label;

/**
 * Holdings, offers and preapprovals answer with an envelope — `{ kind: "available", view: { … } }` — because
 * "the read failed" is a different answer from "there is nothing". The rows are a level down, and a condition
 * that looked at the top level would be false for every answer there has ever been: an unmeetable condition
 * reads exactly like a seed that owes something, which is the one way this pass can lie.
 */
const viewOf = (body: unknown): Record<string, unknown> => rec(rec(body).view);

/**
 * Whether the node's answer to this address held an event where one of **this person's own** parties is
 * among the witnesses, standing in the relation `how` to that event's stakeholders.
 *
 * Read from the trace rather than from our answer on purpose: the rule under test is the one that decides
 * what our answer says about witnesses, so asking our answer would be asking the suspect. The party list is
 * this person's declared one, because the rule never looks at anybody else's.
 */
function witnessedHere(
  seen: Sighting,
  how: (stakeholders: Set<string>, who: string) => boolean,
): boolean {
  const mine = new Set(seen.given.parties.map((p) => p.party));
  return seen.trace.some((call) =>
    [...everyRecord(call.answer)].some((event) => {
      if (!Array.isArray(event.witnessParties) || !Array.isArray(event.signatories)) return false;
      const stakeholders = new Set([...arr(event.signatories), ...arr(event.observers)]);
      return arr(event.witnessParties).some(
        (who) => typeof who === "string" && mine.has(who) && how(stakeholders, who),
      );
    }),
  );
}

export const CONDITIONS: readonly Condition[] = [
  // ── the walk ───────────────────────────────────────────────────────────────────
  {
    name: "somebody sees more active contracts than one node page holds, so the walk resumes",
    keeps:
      "the page walk in core/ledger-request/paginate.ts — with every list fitting in one page, a walk that stopped after the first page would return the same answer as one that did not",
    // **A resumed call that came back with something in it.** The walk always makes one more request than it
    // has pages — an empty answer is the only thing that ends it — so "a request carrying a continuation
    // token" is satisfied by that terminator on every list there has ever been, and would have passed while
    // proving nothing.
    shown: (seen) =>
      seen.trace.some(
        (call) =>
          call.path.startsWith("/v2/state/active-contracts") &&
          typeof rec(call.body).streamContinuationToken === "string" &&
          arr(call.answer).length > 0,
      ),
  },
  {
    name: "the second page of a list is actually asked for, with the cursor the first page gave",
    keeps:
      "the keyset cursor in core/contract-list — a cursor nobody sends back is a value nothing reads, and the rule that it advances past the last row cannot be wrong in a way anyone sees",
    shown: (seen) =>
      at("/api/contracts (the second page)", seen) && arr(rec(seen.body).rows).length > 0,
  },
  {
    name: "one list is long enough that the first page is not the whole of it",
    keeps:
      "`nextCursor` and `total` on the contract list — with every list shorter than a page, null is the right answer everywhere and a rule that always said null would be right too",
    // The cursor is a record of three, not a string — asking whether it is a string would have been a
    // condition no answer could ever meet, which reads exactly like a seed that owes something.
    shown: (seen) =>
      at("/api/contracts", seen) && str(rec(rec(seen.body).nextCursor).contractId) !== null,
  },

  // ── the tokens ─────────────────────────────────────────────────────────────────
  {
    name: "somebody holds a token whose balance decays by the round",
    keeps:
      "`exactBalance` in core/token-holdings — with no such token in the ledger, a build that always answered face_value would agree with every recorded answer (check/mappings/holdings.ts)",
    shown: (seen) =>
      at("/api/holdings", seen) &&
      arr(viewOf(seen.body).groups).some((g) => rec(g).exactBalance === "unavailable_decay"),
  },
  {
    name: "a contract whose standard view the node could not compute",
    keeps:
      "the `problems` list on holdings and offers — a failed view is the one thing that must not become a missing row, and with none in the ledger the difference between reporting it and dropping it is invisible",
    shown: (seen) =>
      (at("/api/holdings", seen) || at("/api/offers", seen)) &&
      arr(viewOf(seen.body).problems).length > 0,
  },
  {
    name: "one person holds an expired and an unexpired preapproval with the same receiver",
    keeps:
      "the order preapprovals are listed in — valid before expired, then by receiver. With one of each per person the second key never decides anything (check/mappings/preapprovals.ts)",
    shown: (seen) => {
      if (!at("/api/preapprovals", seen)) return false;
      const byReceiver = new Map<string, Set<boolean>>();
      for (const row of arr(viewOf(seen.body).rows)) {
        const receiver = str(rec(row).receiver);
        const passed = rec(rec(row).expiry).passed;
        if (receiver === null || typeof passed !== "boolean") continue;
        const seenSoFar = byReceiver.get(receiver) ?? new Set<boolean>();
        seenSoFar.add(passed);
        byReceiver.set(receiver, seenSoFar);
      }
      return [...byReceiver.values()].some((kinds) => kinds.size > 1);
    },
  },

  // ── the history ────────────────────────────────────────────────────────────────
  {
    name: "a contract created and archived inside one window",
    keeps:
      "which of a contract's two events knows its stakeholders (core/timeline/build-lifelines.ts). The product read the window newest-first and kept the archive, which carries none; the bar came out with nobody on it. Both the product and its restatement were wrong at once and both were green",
    shown: (seen) =>
      at("/api/timeline", seen) &&
      [...everyRecord(seen.body)].some(
        (line) =>
          line.state === "archived" &&
          line.startKnown === true &&
          arr(line.parties).length > 0 &&
          typeof line.contractId === "string",
      ),
  },
  {
    name: "an opened update where one of my parties is an observer and not a signatory",
    keeps:
      "the role list on `visibility` (core/visibility/explain-visibility.ts) — with every visible party a signatory, a rule that only ever said signatory would be right every time",
    shown: (seen) =>
      seen.label === "/api/updates/{updateId}" &&
      [...everyRecord(seen.body)].some(
        (reason) =>
          typeof reason.party === "string" &&
          arr(reason.roles).includes("observer") &&
          !arr(reason.roles).includes("signatory"),
      ),
  },

  {
    name: "an opened update where one of my parties saw an event it is not a party to",
    keeps:
      "the third capacity, `witness` (core/visibility/explain-visibility.ts) — the one that says «not mine, and yet I saw it». Without an event of this shape the whole branch can be deleted and no answer changes",
    // **Read from the node's answer, not from ours.** The rule under test is precisely the one that decides
    // whether this shows up in our answer, so asking our answer whether it showed up would be asking the
    // suspect. What the trace holds is the fact itself: an event whose witnesses include somebody who is
    // neither a signatory nor an observer of it.
    // The witness has to be **one of this person's parties** — an event witnessed by somebody else exercises
    // nothing, because the rule only ever runs over the parties the viewer holds (2026-09-18 codex).
    shown: (seen) =>
      seen.label === "/api/updates/{updateId}" &&
      witnessedHere(seen, (stakeholders, who) => !stakeholders.has(who)),
  },
  {
    name: "an opened update where a party is both a stakeholder and listed among the witnesses",
    keeps:
      "«a stakeholder is not also reported as a witness» — the clause that keeps the third capacity from being added to the first two. Canton lists the requesting parties as witnesses of their own events, so without this the word would appear beside every party on the screen",
    shown: (seen) =>
      seen.label === "/api/updates/{updateId}" &&
      witnessedHere(seen, (stakeholders, who) => stakeholders.has(who)),
  },

  // ── the screen ─────────────────────────────────────────────────────────────────
  {
    name: "somebody's home page has more recent updates than it draws",
    keeps:
      "`totalInWindow` beside `rows` on the home card — the two are equal for everybody until a window holds more than the card shows, and until then nothing says the card is a selection",
    shown: (seen) => {
      if (!at("/api/home", seen)) return false;
      const recent = rec(rec(seen.body).recent);
      return (
        recent.status === "ok" &&
        typeof recent.totalInWindow === "number" &&
        arr(recent.rows).length < recent.totalInWindow
      );
    },
  },
  {
    name: "a person the seed left nothing at all",
    keeps:
      "every rule that says a list must be *empty* for someone — without one such person, a row leaking in from another party's data has nowhere to show up as wrong (check/expectations.ts)",
    shown: (seen) => !seen.given.seesContracts && !seen.given.seesUpdates,
  },
];

/**
 * The conditions no seed on this stack can supply. Each says which rule is left unexercised and why the
 * material cannot exist here, so the next person does not go looking for a gap that is not one.
 */
export const OUT_OF_REACH: readonly OutOfReach[] = [
  {
    name: "a point lookup that answers something other than a transaction",
    keeps: "the reassignment branch of the update detail",
    why: "a reassignment needs two synchronizers and this participant is connected to one — the branch is reachable only on a multi-domain ledger",
  },
  {
    name: "a contract detail drawn from an interface view",
    keeps: "`renderMode: interface` in core/contract-detail",
    why: "this address never asks the node for interface views — it reads the active contracts with a wildcard filter (router.ts), so no answer it can give carries one. Not a gap in the seed: the branch is unreachable through this address at all, and what would reach it is a different question",
  },
  {
    name: "a preapproval or a holding whose payload is not the shape its template declares",
    keeps: "the `payload_shape_mismatch` problem rows of the template-adapter path",
    why: "a typed Daml template cannot produce one. The rule guards against a node that answers something else, which is worth keeping and cannot be staged from a ledger",
  },
  {
    name: "a session answer whose token can be decoded",
    keeps: "the claims the session answer repeats back",
    why: "the recorded people carry no JWT — the tape keys on a name, not a token (check/fixtures/README.md). It runs against a real participant and is green there, and it is the one claim CI cannot reach",
  },
  {
    name: "a lifeline in the `unknown` state",
    keeps: "the third state of a timeline bar",
    why: "an unfiltered window that sees a creation sees its archive too, so a contract is either alive or archived. The state exists for a party-filtered window, and these rules do not describe a filtered question yet",
  },
];

/**
 * Which conditions nothing showed. **The answer is the whole point of the pass**: a condition that no
 * sighting satisfies means the rule it keeps is being agreed with by nothing at all.
 */
export function unmet(sightings: readonly Sighting[]): Condition[] {
  return CONDITIONS.filter((condition) => !sightings.some((seen) => condition.shown(seen)));
}
