// **Reading the node calls one API question produced.** Not rules — plumbing the rules stand on.
//
// A rule says what the answer should hold; these say where in the trace the material is. They are shared
// across mappings on purpose: "which of these calls is the unnarrowed active-contracts question" has one
// answer, and writing it out per path would be repeating a lookup, not restating a rule. The rules
// themselves are never shared — each path states its own, because that is the thing being checked.
import { contractsAskedEverything, updatesAskedEverything } from "../own-set.ts";
import type { NodeCall } from "../trace.ts";

export const rec = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
export const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
export const num = (value: unknown): number | null => (typeof value === "number" ? value : null);

export const answerOf = (trace: readonly NodeCall[], method: string, path: string): unknown =>
  trace.find((call) => call.method === method && call.path === path)?.answer;

/** The offset everything on this page was read at, or null when the trace never asked. */
export const ledgerEnd = (trace: readonly NodeCall[]): number | null =>
  num(rec(answerOf(trace, "GET", "/v2/state/ledger-end")).offset);

// **Only the pages asked without narrowing.** One API question can reach the active-contracts path twice —
// once plainly and once with an *interface* filter — and picking by "it is an active-contracts call" would
// fold the narrower question's answer into the wider one's. The judgment belongs to the answer key
// (own-set.ts): "was this asked without narrowing" is one question with one definition.
export const wildcardAcsPages = (trace: readonly NodeCall[]): NodeCall[] =>
  trace.filter(
    (call) =>
      call.method === "POST" &&
      call.path.startsWith("/v2/state/active-contracts") &&
      contractsAskedEverything(call.body),
  );

/**
 * The active-contracts pages asked **through one interface**, with the node's own view attached. A different
 * question from the unnarrowed one and from any other interface's, so it is picked by the id that was asked
 * for — reading "an active-contracts call" would mix three different questions' answers together.
 */
export const acsPagesForInterface = (trace: readonly NodeCall[], interfaceId: string): NodeCall[] =>
  trace.filter((call) => {
    if (call.method !== "POST" || !call.path.startsWith("/v2/state/active-contracts")) return false;
    const filter = rec(rec(call.body).filter);
    const cumulative = [
      ...arr(rec(rec(filter.filtersForAnyParty)).cumulative),
      ...Object.values(rec(filter.filtersByParty)).flatMap((one) => arr(rec(one).cumulative)),
    ];
    return cumulative.some(
      (entry) =>
        rec(rec(rec(rec(entry).identifierFilter).InterfaceFilter).value).interfaceId ===
        interfaceId,
    );
  });

export const wildcardUpdatePages = (trace: readonly NodeCall[]): NodeCall[] =>
  trace.filter(
    (call) =>
      call.method === "POST" &&
      call.path.startsWith("/v2/updates") &&
      updatesAskedEverything(call.body),
  );

/** The parties that are mine, in the order the rights response lists them first. */
export const myParties = (trace: readonly NodeCall[]): string[] => {
  const rights = trace.find((call) => call.path.endsWith("/rights"))?.answer;
  const order: string[] = [];
  for (const item of arr(rec(rights).rights)) {
    const kind = rec(rec(item).kind);
    for (const name of ["CanReadAs", "CanActAs"] as const) {
      const party = str(rec(rec(kind[name]).value).party);
      if (party !== null && !order.includes(party)) order.push(party);
    }
  }
  return order;
};

/** The three pieces of a template identifier: `<packageId>:<Module>:<Entity>`, or null if it is not three. */
export const fqn = (templateId: unknown): [string, string, string] | null => {
  const parts = (str(templateId) ?? "").split(":");
  return parts.length === 3 ? [parts[0] ?? "", parts[1] ?? "", parts[2] ?? ""] : null;
};

export const stringsOf = (value: unknown): string[] =>
  arr(value).filter((v): v is string => typeof v === "string");
