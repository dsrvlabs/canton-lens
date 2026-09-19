// **Judging the question, not only the answer.**
//
// Every other level reads what came back. But the tape is the node's answer to *our* question, so when the
// application asks for too little, the tape holds too little, replay serves too little, and every level
// agrees with itself. Narrowing the request is the one defect this product must never have — it is the
// product's whole first principle ("Canton enforces visibility; we never filter") inverted — and it is
// invisible from inside that loop.
//
// The complete answer to that is the second recording (own-set.ts), which asks the node directly. This file
// is the part that needs no second recording at all: **what the request itself says.** Three claims, all
// checkable against things the check already holds independently of any answer:
//
//   · the parties named in the request are exactly the ones this person was *given* (check/given.ts), or
//     the request names none and uses `filtersForAnyParty`, which only a super reader may do;
//   · the offset the request reads at is the offset the ledger end reported, when the caller named none;
//   · a point lookup asks for the thing the address named.
//
// All of them are about the question. None is derived from what came back, so none can be laundered by a
// wrong answer.
import { type Given, partyNames } from "./given.ts";
import type { NodeCall } from "./trace.ts";

const rec = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** The party scope one request asked for: which parties it named, and whether it asked as any party. */
export type AskedScope = { parties: string[]; anyParty: boolean };

/**
 * Where a request carries its party filter. The active-contracts body holds it at `filter`; the updates body
 * buries it under the update format. A request with neither is not asking about anybody's data.
 */
const filterOf = (body: unknown): Record<string, unknown> | null => {
  const asContracts = rec(rec(body).filter);
  if (Object.keys(asContracts).length > 0) return asContracts;
  const asUpdates = rec(rec(rec(rec(rec(body).updateFormat).includeTransactions).eventFormat));
  return Object.keys(asUpdates).length > 0 ? asUpdates : null;
};

export const askedScope = (body: unknown): AskedScope | null => {
  const filter = filterOf(body);
  if (filter === null) return null;
  return {
    parties: Object.keys(rec(filter.filtersByParty)),
    // `filtersForAnyParty` carries its own `cumulative`; a bare list is refused by the node with a 400.
    anyParty: arr(rec(filter.filtersForAnyParty).cumulative).length > 0,
  };
};

// Compared as sets — the node takes the parties as an object's keys, so their order is not a claim.
const same = (a: readonly string[], b: readonly string[]): boolean => {
  const mine = new Set(a);
  return mine.size === new Set(b).size && b.every((one) => mine.has(one));
};

/** The path segment of a point-lookup address, decoded — `/api/updates/1220ab` gives `1220ab`. */
const lastSegment = (url: string): string =>
  decodeURIComponent((url.split("?")[0] ?? "").split("/").pop() ?? "");

/**
 * What is wrong with the questions one API call put to the node, if anything.
 *
 * @param url   the address that was asked, so a caller-named offset can be honoured
 * @param given what this person was given — declared, never worked out from our own answers
 */
export function questionProblems(url: string, trace: readonly NodeCall[], given: Given): string[] {
  const problems: string[] = [];
  const mine = partyNames(given);
  const query = new URL(url, "http://check").searchParams;
  const calledOffset = query.get("offset");
  const path = url.split("?")[0] ?? "";
  const end = rec(
    trace.find((call) => call.method === "GET" && call.path === "/v2/state/ledger-end")?.answer,
  ).offset;

  for (const call of trace) {
    if (call.method !== "POST") continue;

    // ── a point lookup asks for the thing the address named ────────────────────
    // Without this the check reads whatever the lookup returned and builds the expected answer out of it —
    // so a router that looked up the wrong update would be agreed with. The tape happens to go red today
    // because a changed request is a changed key, but that is the tape's accident, not a judgement.
    if (call.path === "/v2/updates/update-by-id" && path.startsWith("/api/updates/")) {
      const asked = rec(call.body).updateId;
      if (asked !== lastSegment(url)) {
        problems.push(`the address named one update and the node was asked for another`);
      }
    }
    if (call.path === "/v2/updates/update-by-offset" && path.includes("/by-offset/")) {
      const asked = rec(call.body).offset;
      if (String(asked) !== lastSegment(url)) {
        problems.push(
          `the address named offset ${lastSegment(url)} and the node was asked for ${asked}`,
        );
      }
    }

    const scope = askedScope(call.body);
    if (scope === null) continue;

    // ── who the question was about ─────────────────────────────────────────────
    // **A super reader names nobody on purpose.** Naming their parties would narrow the question back down,
    // and they have none to name. Everyone else must name every party they hold: asking about a subset is
    // the shape of the defect this file exists for.
    if (scope.anyParty) {
      if (!given.readsEveryParty) {
        problems.push(`${call.path} asked as any party, and this person was not given that right`);
      }
      if (scope.parties.length > 0) {
        problems.push(
          `${call.path} asked as any party and also named ${scope.parties.length} — the wider question already covers them`,
        );
      }
    } else if (!same(scope.parties, mine)) {
      problems.push(
        `${call.path} asked about ${scope.parties.length} of this person's ${mine.length} parties`,
      );
    }

    // ── and at which point ─────────────────────────────────────────────────────
    // A read at some other offset is a read of some other moment. The one exception is a caller who named
    // an offset, and the check never does.
    if (calledOffset === null && typeof end === "number") {
      const at = rec(call.body).activeAtOffset;
      if (typeof at === "number" && at !== end) {
        problems.push(`${call.path} read the contracts at ${at}, not at the ledger end ${end}`);
      }
      const to = rec(call.body).endInclusive;
      if (typeof to === "number" && to !== end) {
        problems.push(`${call.path} read the updates up to ${to}, not to the ledger end ${end}`);
      }
    }
  }
  return problems;
}
