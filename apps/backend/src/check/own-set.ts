// **The second recording: what the node says this person can see, asked without going through us.**
//
// The tape (ledger-tape.ts) is the answer to *our* questions, so it can only judge what we did with what we
// received. It cannot judge the question itself. When the application asks the node for too little, the tape
// holds too little, replay serves too little, the screen draws too little — and everything agrees. A whole
// class of defect (a contract quietly missing from someone's list) is invisible from inside that loop.
//
// So there is a second recording, made by asking the node directly with a person's token. **It computes
// nothing** — it asks and stores. Two questions, and only two:
//
//   1. POST /v2/state/active-contracts — every contract this person can see at this offset
//   2. POST /v2/updates                — every update this person can see from 0 to this offset
//
// Nothing else is in scope: trees, reassignments and completions are not things this product shows.
//
// This file is the format and the comparison. The recording itself is made later, once every address has
// rules; settling the shape first is what keeps the recorder from deciding it by accident.

/** One person's answers, and the questions that produced them. */
export type OwnSetEntry = {
  who: string;
  /** The parties named in the request. Empty when asked as a super reader, which names none. */
  parties: string[];
  /** True when the request used `filtersForAnyParty` — the only shape that may name no party. */
  askedAsAnyParty: boolean;
  /**
   * The request bodies exactly as they went out. **They are kept so the check can prove nothing was
   * narrowed.** A recording made with a template filter is smaller than the truth, and a smaller answer key
   * passes an application that drops things — the most dangerous mistake available here.
   */
  asked: { contracts: unknown; updates: unknown };
  contractIds: string[];
  updateIds: string[];
  /**
   * Why the recorder stopped asking for more pages. Both questions arrive 200 at a time with a continuation
   * token, and only **the node having no more** makes this a complete answer key. A recorder that gave up at
   * its own page limit has written down a smaller truth, which is the one thing an answer key may not be.
   */
  stoppedBecause: "node_had_no_more" | "page_limit";
};

export type OwnSet = {
  /** The offset both questions were asked at. It must be the offset the replay tape was recorded at. */
  atOffset: number;
  entries: OwnSetEntry[];
};

// ── Was the question asked without narrowing it ──────────────────────────────────
// Both guards below are the same question in two body shapes. A `WildcardFilter` asks for everything the
// party can see; an `InterfaceFilter` or a template filter asks for less.

const rec = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Every cumulative filter in an event format is a wildcard, and there is at least one. */
function eventFormatIsWildcard(format: unknown): boolean {
  const byParty = Object.values(rec(rec(format).filtersByParty));
  const anyParty = arr(rec(format).filtersForAnyParty);
  const cumulative = [...byParty.flatMap((f) => arr(rec(f).cumulative)), ...anyParty];
  return (
    cumulative.length > 0 &&
    cumulative.every((c) => rec(rec(c).identifierFilter).WildcardFilter !== undefined)
  );
}

/** POST /v2/state/active-contracts — the filter sits at the top of the body. */
export const contractsAskedEverything = (body: unknown): boolean =>
  eventFormatIsWildcard(rec(body).filter);

/** POST /v2/updates — the filter sits under the transaction format. */
export const updatesAskedEverything = (body: unknown): boolean =>
  eventFormatIsWildcard(rec(rec(rec(rec(body).updateFormat).includeTransactions).eventFormat));

// ── Comparing ────────────────────────────────────────────────────────────────────

/**
 * **The two directions are different defects and are never merged.**
 *   missing — the node says this person can see it and our answer does not. That is ⑥.
 *   extra   — our answer holds something the node did not say they can see. That is ①, the other direction,
 *             and it is the more serious of the two.
 */
export type SetDifference = { missing: string[]; extra: string[] };

export function compareIdSets(
  recorded: readonly string[],
  shown: readonly string[],
): SetDifference {
  const inRecording = new Set(recorded);
  const inAnswer = new Set(shown);
  return {
    missing: [...inRecording].filter((id) => !inAnswer.has(id)),
    extra: [...inAnswer].filter((id) => !inRecording.has(id)),
  };
}

/**
 * What must be true of a recording before anything is compared against it. A recording that fails any of
 * these is not an answer key, and using it would turn a silent hole into a green light.
 */
export function validateOwnSet(own: OwnSet, tapeOffset: number): string[] {
  const problems: string[] = [];
  if (own.atOffset !== tapeOffset) {
    // Two recordings taken at different points disagree about contracts created in between, and every
    // difference then reads as a defect.
    problems.push(
      `the answer key was taken at offset ${own.atOffset} and the tape at ${tapeOffset} — they must be the same point`,
    );
  }
  if (own.entries.length === 0) problems.push("the answer key holds nobody");
  for (const entry of own.entries) {
    if (!contractsAskedEverything(entry.asked.contracts)) {
      problems.push(
        `${entry.who}: the contracts question was narrowed — it must be a wildcard filter`,
      );
    }
    if (!updatesAskedEverything(entry.asked.updates)) {
      problems.push(
        `${entry.who}: the updates question was narrowed — it must be a wildcard filter`,
      );
    }
    if (entry.stoppedBecause !== "node_had_no_more") {
      problems.push(
        `${entry.who}: the recorder stopped at its own page limit — this answer key is short`,
      );
    }
    if (entry.askedAsAnyParty) {
      // A super reader's request names no party, and naming one would narrow it back down.
      if (entry.parties.length > 0) {
        problems.push(
          `${entry.who}: asked as every party and still named ${entry.parties.length} of them`,
        );
      }
    } else if (entry.parties.length === 0) {
      problems.push(`${entry.who}: named no party and did not ask as every party`);
    }
  }
  return problems;
}
