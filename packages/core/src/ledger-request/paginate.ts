import { interpretLedgerResponse } from "./interpret.ts";
import type { LedgerCallResult, LedgerRequest, LedgerSend } from "./types.ts";

// **Why any of this exists.** Canton's JSON API refuses to put more than `http-list-max-elements-limit`
// elements (default 200) into one response. Over that it answers
// `413 JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED` — a real participant with 201 active contracts
// answered exactly that, and the whole screen went dark. The rule belongs to the JSON API layer, not to one
// endpoint: the node's own OpenAPI declares only 200 and 400 anywhere, so **any** list-returning call can
// trip it. Asking for a whole list in one request is therefore not something this layer may do.
//
// Two of the four list calls this product makes have a way to ask for the list in parts (see below); this
// file is the single loop both use, so that the rule about when to stop is written once.

// **What this does not solve.** Asking in parts bounds one response, not the work. The assembled list is
// still held whole and then filtered, sorted and paged in memory, so the ceiling has moved to
// LEDGER_MAX_ELEMENTS rather than been removed, and a list past that is refused rather than served. Three
// things stand between this and a list of any size:
//   - The template and party filter the caller supplies is applied after the list arrives, never carried
//     into the request, so the walk is always as long as the unfiltered list.
//   - Every party the viewer holds goes into one request. A viewer holding many parties can exceed the
//     node's limit on the first page no matter how the walk is bounded; the request itself has to be split.
//   - The screens order newest first, while a walk only moves forward through the snapshot and cannot
//     order. A page of a screen is therefore not a page of a walk, which is why the whole list has to be
//     assembled before the first row can be drawn. Making the two orders the same would remove that need.
// The other two list calls this product makes (packages, user rights) have no resume mechanism at all, so
// for those the node's own `http-list-max-elements-limit` is the only lever.

// **How big a part to ask for.** 200 is Canton's own default for `http-list-max-elements-limit`. A node
// configured lower does not break the loop: the node clamps (`limit` "is ignored if is bigger than server
// setting") and the parts simply come back smaller. Asking for more than the node allows is the one thing
// that must not happen, and 200 is the documented ceiling.
export const LEDGER_PAGE_SIZE = 200;

// **What bounds the loop.** Two separate hazards, so two separate bounds.
//   - Elements bound the memory: every part is held until the whole list is assembled, and this layer hands
//     the caller one complete list.
//   - Pages bound the number of round trips: against a node whose limit is small, an element bound alone
//     would allow hundreds of requests before it is reached.
// Crossing either is **not** answered with the part already collected. A short list returned as if it were
// the whole one is the failure this product refuses to produce (a failed read is never 0·[]·null), so it is
// answered with too_many_elements — the same name the node's own 413 carries, because it is the same
// circumstance: this list is larger than this path will serve.
export const LEDGER_MAX_ELEMENTS = 10_000;
export const LEDGER_MAX_PAGES = 200;

// The cursor is whatever the endpoint's own resume mechanism takes: an opaque string
// (active-contracts: streamContinuationToken) or a number (updates: the offset to begin exclusively after).
export type LedgerPageCursor = string | number;

export function withPageLimit(path: string, pageSize: number): string {
  return `${path}${path.includes("?") ? "&" : "?"}limit=${pageSize}`;
}

// Walks one list endpoint until the list is exhausted and returns it as a single array.
//
// **When the walk stops.** Only an empty page ends it. Not "a page shorter than the size asked for" — a node
// whose `http-list-max-elements-limit` is below LEDGER_PAGE_SIZE clamps every page to its own limit, so every
// page is short, and stopping on a short page would quietly return the first page as though it were the whole
// list. The cost of the strict rule is exactly one extra request per list (the empty one that ends it).
//
// **A page that fails ends the whole call.** The failure is returned as it stands and the pages already
// collected are dropped. Half a snapshot that reads as a whole one is worse than a named failure.
export async function collectLedgerPages(
  send: LedgerSend,
  buildRequest: (cursor: LedgerPageCursor | undefined) => LedgerRequest,
  readCursor: (lastElement: unknown) => LedgerPageCursor | undefined,
): Promise<LedgerCallResult<unknown[]>> {
  const collected: unknown[] = [];
  let cursor: LedgerPageCursor | undefined;

  for (let page = 0; page < LEDGER_MAX_PAGES; page++) {
    let response: { status: number; body: unknown };
    // **Built outside the catch.** Building a request is not sending one, so a caller-contract error here
    // (a filter that is neither shape) must not be reported as `unreachable` — the node was never asked.
    const request = buildRequest(cursor);
    try {
      response = await send(request);
    } catch (error) {
      return {
        ok: false,
        reason: "unreachable",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    const result = interpretLedgerResponse<unknown>(response.status, response.body);
    if (!result.ok) return result;
    if (!Array.isArray(result.value)) {
      return { ok: false, reason: "node_error", detail: "list response is not an array" };
    }
    if (result.value.length === 0) {
      return { ok: true, value: collected };
    }
    if (collected.length + result.value.length > LEDGER_MAX_ELEMENTS) {
      return {
        ok: false,
        reason: "too_many_elements",
        detail: `list exceeds ${LEDGER_MAX_ELEMENTS} elements`,
      };
    }
    collected.push(...result.value);
    const next = readCursor(result.value[result.value.length - 1]);
    // A page arrived with something in it but with no position to continue from. Canton 3.5 puts one on
    // every element of both paged endpoints, so this is a shape this layer does not know — and it cannot be
    // read as “the end”, because then a truncated list would be served as a whole one.
    if (next === undefined) {
      return {
        ok: false,
        reason: "node_error",
        detail: "list page carries no position to continue from",
      };
    }
    cursor = next;
  }
  return {
    ok: false,
    reason: "too_many_elements",
    detail: `list did not end within ${LEDGER_MAX_PAGES} pages`,
  };
}
