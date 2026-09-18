// **The addresses this application answers, written once.**
//
// They used to live as fifteen booleans and five regexes inside `routeRequest`, which meant the set of
// addresses could only be read by reading the dispatch. Nothing could compare it to anything: a path added
// here and forgotten in the document, or the other way round, was invisible. Now the set is a value, and
// `apps/backend/src/check/paths.ts` puts it beside openapi and beside the check table and requires all three
// to name the same addresses.
//
// **The template strings are openapi's, character for character** (`/api/updates/{updateId}`, not
// `:updateId`). That is what makes the comparison an equality rather than a translation — a translation is a
// place for the two to drift while the check stays green.

export type Route = {
  /**
   * The method this address answers. Every one of them is GET today and the router refuses anything else
   * with a 405 — but the set is compared with openapi *by operation*, and an operation is a method and a
   * path. Without the method here, a POST added to the document could never be reported as missing from the
   * router, because the router's side of the comparison would not be able to say what it answers.
   */
  readonly method: "GET";
  /** The openapi path template. */
  readonly template: string;
  /** Anchored. A route that takes a segment captures it in group 1; the others capture nothing. */
  readonly pattern: RegExp;
};

// **First match wins, and the list is ordered specific-first.** `/api/updates/by-offset/{offset}` is listed
// before `/api/updates/{updateId}`. Today that is belt and braces — `([^/]+)` stops at a slash, so the id form
// cannot swallow a two-segment path — but the router used to carry an explicit `byOffset ? null : …` guard for
// exactly this, and the ordering is the rule a reader can apply to the next route added without re-deriving
// which regexes happen to be disjoint.
export const ROUTES: readonly Route[] = [
  { method: "GET", template: "/api/session", pattern: /^\/api\/session$/ },
  { method: "GET", template: "/api/node", pattern: /^\/api\/node$/ },
  { method: "GET", template: "/api/home", pattern: /^\/api\/home$/ },
  { method: "GET", template: "/api/search", pattern: /^\/api\/search$/ },
  { method: "GET", template: "/api/contracts", pattern: /^\/api\/contracts$/ },
  {
    method: "GET",
    template: "/api/contracts/{contractId}",
    pattern: /^\/api\/contracts\/([^/]+)$/,
  },
  { method: "GET", template: "/api/updates", pattern: /^\/api\/updates$/ },
  {
    method: "GET",
    template: "/api/updates/by-offset/{offset}",
    pattern: /^\/api\/updates\/by-offset\/([^/]+)$/,
  },
  // It does not accept digits only — if `-2` failed to match the path it would become “no such thing” (404),
  // and the place to say “the format is wrong” would disappear. Match the path broadly; malformed values are
  // cut off with a 400 at the validation site in the router.
  { method: "GET", template: "/api/updates/{updateId}", pattern: /^\/api\/updates\/([^/]+)$/ },
  { method: "GET", template: "/api/timeline", pattern: /^\/api\/timeline$/ },
  { method: "GET", template: "/api/holdings", pattern: /^\/api\/holdings$/ },
  { method: "GET", template: "/api/offers", pattern: /^\/api\/offers$/ },
  { method: "GET", template: "/api/preapprovals", pattern: /^\/api\/preapprovals$/ },
  { method: "GET", template: "/api/catalog/templates", pattern: /^\/api\/catalog\/templates$/ },
  { method: "GET", template: "/api/catalog/packages", pattern: /^\/api\/catalog\/packages$/ },
  { method: "GET", template: "/api/party/{partyId}", pattern: /^\/api\/party\/([^/]+)$/ },
  // `[0-9a-f]{64}` — a package id is a content hash, and a path that is not one is not this address.
  {
    method: "GET",
    template: "/api/packages/{packageId}/schema",
    pattern: /^\/api\/packages\/([0-9a-f]{64})\/schema$/,
  },
];

export type RouteMatch = {
  readonly method: "GET";
  readonly template: string;
  /** The captured segment, still percent-encoded; `null` for an address that takes none. */
  readonly captured: string | null;
};

/** First match wins. `null` means this application has no such address — the router's 404. */
export function matchRoute(path: string): RouteMatch | null {
  for (const route of ROUTES) {
    const found = route.pattern.exec(path);
    if (found === null) continue;
    return { method: route.method, template: route.template, captured: found[1] ?? null };
  }
  return null;
}

export const routeTemplates = (): string[] => ROUTES.map((r) => r.template);

/** The addresses as openapi names an operation: `"GET /api/session"`. */
export const routeOperations = (): string[] => ROUTES.map((r) => `${r.method} ${r.template}`);
