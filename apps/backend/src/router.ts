// Pure router: it does not start a server or open a socket. It goes as far as wiring routes to core functions and
// mapping failures to status codes. Judgment (visibility·status-code mapping) is not reimplemented.
import type {
  HomeSource,
  LedgerCallResult,
  LedgerPartyFilter,
  LedgerRequest,
  LedgerSend,
  NodeOffsetReading,
  PackageSchema,
  ViewerScope,
} from "@canton-lens/core";
import {
  buildContractDetail,
  buildContractList,
  buildHomeSummary,
  buildLifelines,
  buildNodeStatusSnapshot,
  buildPackageCatalog,
  buildPackageSchema,
  buildRecentUpdates,
  buildSearchResults,
  buildTemplateCatalog,
  buildTokenHoldings,
  buildTransferOffers,
  buildTransferPreapprovals,
  buildUpdateDetail,
  buildViewerParties,
  callGetActiveContracts,
  callGetAuthenticatedUser,
  callGetLedgerEnd,
  callGetPackage,
  callGetRecentUpdates,
  callGetUpdateById,
  callGetUpdateByOffset,
  callGetUpdates,
  callGetVersion,
  callListPackages,
  callListUserRights,
  classifySearchInput,
  filterAndPageUpdates,
  findTemplate,
  groupLifelines,
  isWellFormedInterfaceId,
  parseTemplateFqn,
  RECENT_UPDATES_LOOKBACK,
  RECENT_UPDATES_MAX_LOOKBACK,
  readTokenClaims,
  searchPartyInActiveContracts,
  typeRecordFields,
} from "@canton-lens/core";
import {
  type EnvelopeResult,
  toContractListEntries,
  toLedgerAcsEntries,
  toRawCreatedEvents,
  toUpdateEntries,
} from "./envelope.ts";
import { ledgerFailureToHttp } from "./ledger-failure-to-http.ts";
import { withAuth } from "./ledger-send-with-token.ts";
import type { RouterRequest, RouterResponse } from "./router-types.ts";
import { matchRoute } from "./routes.ts";

// The addresses themselves live in `routes.ts`, as one list this file and the check both read.
// Update detail is a **point lookup**. By id, or by offset (the creating-update link from Contracts).
// The real shape of an update id. The multihash prefix `1220` (sha2-256, 32 bytes) + 64 hex characters = 68
// characters (verified across all 30 updates on a real node). Passing a malformed one straight to
// the ledger made the ledger answer 400, and that went out as a 502 — a caller's fault is cut off with a 400
// in this layer. **If the hash changes, this length changes too.**
const UPDATE_ID_SHAPE = /^1220[0-9a-f]{64}$/;

// **Schema cache** — content-addressed (packageId), so the decoded *shape* is the same value for everyone.
// “No caching of ledger data” (a v1 non-goal — if the app keeps data whose answer differs per person in one
// slot, it is a leak channel) is invariant. What this map holds is the parse result, not the permission to see
// it: `loadSchema` asks the ledger on every call and consults this map only after the ledger has agreed.
// Failures are not cached.
const schemaCache = new Map<string, PackageSchema>();
export type SchemaSource =
  | { status: "ok"; schema: PackageSchema }
  | { status: "unavailable"; reason: string };
async function loadSchema(send: LedgerSend, packageId: string): Promise<SchemaSource> {
  // **The ledger is always asked, even on a cache hit.** The cache skips *decoding*, never *authorization*.
  //
  // It used to return the cached schema before calling `send`, which made the answer independent of who was
  // asking. But this route's contract documents a 403 — "the participant answered that the token has no right
  // to make this query" (ledgerFailureResponses in openapi.ts) — so whether a package can be read is the
  // ledger's decision per token. With the old order, user A reading package P would warm the cache and user B,
  // whom the ledger would refuse, received A's schema without `send` ever being called. The comment above
  // claimed this cache sat outside the user-data boundary because a package is content-addressed; that is true
  // of the *bytes* and false of the *permission to see them*.
  //
  // The expensive part is parsing the protobuf, not the fetch, and that is what stays cached.
  const bytes = await callGetPackage(send, packageId);
  if (!bytes.ok) return { status: "unavailable", reason: bytes.reason };
  const cached = schemaCache.get(packageId);
  if (cached !== undefined) return { status: "ok", schema: cached };
  const built = buildPackageSchema(bytes.value, packageId);
  if (!built.ok) return { status: "unavailable", reason: built.reason };
  schemaCache.set(packageId, built.schema);
  return { status: "ok", schema: built.schema };
}
// So that tests can clear the cache — product code does not call it.
export function _clearSchemaCache(): void {
  schemaCache.clear();
}
// Type definitions from other packages are looked up only in the already-read cache (no extra download). If absent, the screen draws that field as Raw.
const cachedLookup = (pkg: { kind: string; packageId?: string }): PackageSchema | null =>
  pkg.kind === "imported" && pkg.packageId !== undefined
    ? (schemaCache.get(pkg.packageId) ?? null)
    : null;

// **What "recent" means for the lists** (/api/updates and the home's recent list) is decided in core,
// `callGetRecentUpdates`: a window that starts RECENT_UPDATES_LOOKBACK offsets back and widens, in steps,
// until it holds RECENT_UPDATES_TARGET of the viewer's transactions, reaches the ledger's start, or reaches
// RECENT_UPDATES_MAX_LOOKBACK. The point is still not to scan from 0 (older history is not served), and a
// past the participant has pruned ends the widening rather than the read. Every response says where its
// window starts (beginExclusive), because the width is no longer a constant the screen could assume.
//
// **The widest window the Timeline can draw at once.** The Timeline is the screen where a range is chosen,
// so it has a bound of its own — the same reach the lists have, so that a range a viewer picks can go as
// far back as the recent window went on its own. Not unbounded: leaving from at 0 makes the node stream
// the whole ledger, and that much never even reaches the browser. Past the bound it is not quietly trimmed
// but sent back as a 400 (window_too_wide): if the requested range and the drawn range differ, the picture
// lies.
//
// **When nothing is chosen, the Timeline draws the same window the lists call recent** — the one
// callGetRecentUpdates widened until it held the viewer's transactions. It used to draw the latest 100
// offsets, a width that on a shared participant was measured at about twenty-five minutes, so the screen
// opened empty for a viewer whose contracts move a few times a day. A board that opens on nothing is not
// light; it is blank.
const TIMELINE_MAX_SPAN = RECENT_UPDATES_MAX_LOOKBACK;

// **Negatives are not accepted.** Nothing here — offset, epoch ms, page size — has a meaning when negative,
// yet the old regex let `-2` through, that value went straight to the ledger, and when the ledger rejected it
// the answer was a 502 (node_error) — **a caller's fault reported as a server fault.** 400 is correct.
// `/api/party/{id}?offset=-2` is the case in point: it has to come back as a 400.
//
// It is `[0-9]` rather than `\d` for **portability**. JSON Schema uses ECMA-262 regular expressions, and
// there `\d` is ASCII `0`–`9` — normatively it does not accept Unicode digits. But a tool reading the schema
// may interpret it with its own language's regex engine: the checker we used (Python-based) read `\d` as
// Unicode in its `re` module and sent Devanagari digits as “valid per the document”. Written `[0-9]`, it
// means the same thing in every language.
// (The cause is the engine doing the reading, not the semantics of JSON Schema itself. Measured: JS
//  `/^\d+$/` rejects `१२३`, Python `re` accepts it.)
// **Only the canonical notation is accepted** — decimal with no leading zero, at most 15 characters.
//
// This blocks two accidents at once. ① With only `^[0-9]+$`, `13629313985320421295` passes and
// `Number.parseInt` silently turns it into a different number (precision loss) before it goes to the ledger.
// ② Allowing leading zeros creates values that are small but whose string is long, such as
// `0000000000000000`, so a length bound in the document would disagree with the code. Forbidding leading
// zeros makes **at most 15 characters = a safe integer**, so the document's `maxLength: 15` and the code say
// exactly the same thing. Real offsets and epoch ms never come near this.
const CANONICAL_INT = /^(?:0|[1-9][0-9]{0,14})$/;
const POSITIVE_INT = /^[1-9][0-9]{0,14}$/;

function isNonNegativeIntegerString(s: string): boolean {
  return CANONICAL_INT.test(s);
}

function isPositiveIntegerString(s: string): boolean {
  return POSITIVE_INT.test(s);
}

// Party list filters travel as one comma-separated query value because RouterRequest deliberately keeps
// a small Record<string, string> shape. Empty pieces and duplicates do not become filter conditions.
function parsePartyFilter(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((party) => party.trim())
        .filter(Boolean),
    ),
  );
}

// The reference instant for judging expiry. Checking only that it was “present” let `asOf=null` through with
// a 200 and **the expiry calculation was silently wrong** — the worst kind, where the value rather than the
// status code is wrong.
//
// The document says `format: date-time` (RFC 3339), so that much is checked. A shape prefix plus
// `Date.parse` alone let three things leak through:
//   · `"2026-09-06T12:00:00"` — with no timezone it is interpreted in **the server's timezone**. The same
//     request answers differently on different machines, and expiry judgments are off by hours.
//   · `"2026-02-30T00:00:00Z"` — a date that does not exist, yet it **rolls over to March 2.** It silently
//     becomes a different instant.
//   · `"2026-09-06T12:00"` — parses even without seconds.
// So both the shape (seconds and timezone required) and **whether the date exists on the calendar** are
// checked. Out-of-range hours, minutes and seconds are already filtered to NaN by `Date.parse`
// (`99:00`, `+99:00`).
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

// Exported so tests can call this judgment directly — the rule has many small branches (leap years, rolling
// dates, timezones) and standing up the whole router to check them is too coarse a net. Same reason as
// `_clearSchemaCache`.
export function _isInstantString(s: string): boolean {
  const m = RFC3339.exec(s);
  if (m === null || Number.isNaN(Date.parse(s))) return false;
  // Catches a rolled-over date. Only “does this day exist on the calendar” matters, independent of
  // timezone, so it is reconstructed in UTC.
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function decodePathSegment(raw: string): { ok: true; value: string } | { ok: false } {
  try {
    return { ok: true, value: decodeURIComponent(raw) };
  } catch {
    return { ok: false };
  }
}

// The viewer's party set, or the reason it cannot be used. The `no_party_rights` case carries neither
// field on purpose — a caller cannot reach the ledger with an empty filter by accident; it has to answer
// that case first.
//
// **The reader case carries two party-shaped fields and they are not the same question.**
//
//   filter      what to ask the ledger with. `{ parties }` for nearly everyone, `{ anyParty: true }` for a
//               viewer holding CanReadAsAnyParty. Goes to callGetActiveContracts · callGetUpdates ·
//               callGetUpdateById · callGetUpdateByOffset and nowhere else.
//   ownParties  whose "mine" this is — the parties that answer "why can I see this", "did I send or receive
//               it", "which of my parties are on it". Goes to the core builders. **Empty for a super
//               reader**, who is reading as everyone and so is party to nothing.
//
// They used to be one array, which worked only while every viewer's answer to both was the same list.
type ResolvedViewer =
  | {
      ok: true;
      kind: "parties";
      filter: LedgerPartyFilter;
      ownParties: string[];
      scope: ViewerScope;
    }
  | { ok: true; kind: "no_party_rights" }
  | { ok: false; http: RouterResponse };

// A ledger user with neither CanReadAs nor CanActAs has no party filter to query with. Sending the empty
// filter anyway makes the participant reject the request, and this layer reads that rejection as
// node_error (502) — a healthy node reported as broken. The circumstance is the viewer's rights, not the
// node's state, so it is answered here, under the name core already gives it (buildHomeSummary's
// cards.status).
const noPartyRights = (): RouterResponse => ({ status: 403, body: { reason: "no_party_rights" } });

async function resolveViewer(send: LedgerSend): Promise<ResolvedViewer> {
  const userResult: LedgerCallResult<unknown> = await callGetAuthenticatedUser(send);
  if (!userResult.ok) {
    return { ok: false, http: ledgerFailureToHttp(userResult.reason) };
  }
  const userValue = userResult.value as { user?: { id?: unknown } };
  const userId = typeof userValue?.user?.id === "string" ? userValue.user.id : "";
  const rightsResult: LedgerCallResult<unknown> = await callListUserRights(send, userId);
  if (!rightsResult.ok) {
    return { ok: false, http: ledgerFailureToHttp(rightsResult.reason) };
  }
  const view = buildViewerParties(userResult.value, rightsResult.value);
  if (view.outcome === "unavailable") {
    // Copies the core result as is — the brief does not demand a separate status code, so
    // the router does not invent a new one. This path differs from the /api/session-only outcome
    // treatment; on /api/contracts·/api/contracts/{id} the viewer cannot be obtained,
    // so it is mapped to 502 (treated as a data problem on the ledger side).
    return { ok: false, http: { status: 502, body: { reason: "node_error" } } };
  }
  const ownParties = view.parties.map((p) => p.party);
  // **The scope decides what to ask with; the party list decides whose "mine" it is.** They are read
  // separately because a viewer can hold both CanReadAsAnyParty and a CanReadAs of their own, and that
  // viewer reads everything *and* has parties to call theirs. Deciding the filter on the list instead
  // would quietly narrow them to their own parties while the screen above kept saying "whole instance".
  const filter: LedgerPartyFilter =
    view.scope === "instance-wide" ? { anyParty: true } : { parties: ownParties };

  // **Holding no party of one's own is not the same as holding no rights.** A super reader has none and
  // reads all of them. Judging on the empty list alone answered them 403 and made their response
  // identical, byte for byte, to a viewer holding nothing.
  //
  // core is the only place that sees the raw rights, so it is the only place that can tell these two
  // apart (build-viewer-parties.ts).
  if (ownParties.length === 0 && view.scope !== "instance-wide") {
    return { ok: true, kind: "no_party_rights" };
  }
  return { ok: true, kind: "parties", filter, ownParties, scope: view.scope };
}

async function resolveOffset(
  send: LedgerSend,
  query: Record<string, string>,
): Promise<{ ok: true; offset: number } | { ok: false; http: RouterResponse }> {
  if (query.offset !== undefined) {
    if (!isNonNegativeIntegerString(query.offset)) {
      return { ok: false, http: { status: 400, body: { reason: "invalid_offset" } } };
    }
    return { ok: true, offset: Number.parseInt(query.offset, 10) };
  }
  const endResult: LedgerCallResult<unknown> = await callGetLedgerEnd(send);
  if (!endResult.ok) {
    return { ok: false, http: ledgerFailureToHttp(endResult.reason) };
  }
  const value = endResult.value as { offset?: unknown };
  if (typeof value?.offset !== "number") {
    return { ok: false, http: { status: 502, body: { reason: "node_error" } } };
  }
  return { ok: true, offset: value.offset };
}

// Reads one piece of the home and maps it to “received / not received”. The home stands the rest of the
// snapshot even if one piece does not come (only that card “could not be fetched”), so here it is
// not promoted to a status code and the failure name is put into the value as is. The name is one of the five ledger failures or the envelope's.
//
async function readHomeAcs<T>(
  send: LedgerSend,
  filter: LedgerPartyFilter,
  offset: number,
  envelope: (raw: unknown) => EnvelopeResult<T>,
  interfaceId?: string,
): Promise<HomeSource<T[]>> {
  const result: LedgerCallResult<unknown> = await callGetActiveContracts(
    send,
    filter,
    offset,
    interfaceId,
  );
  if (!result.ok) return { ok: false, reason: result.reason };
  const rows = envelope(result.value);
  return rows.ok ? { ok: true, value: rows.rows } : { ok: false, reason: rows.reason };
}

export async function routeRequest(
  req: RouterRequest,
  deps: { send: LedgerSend },
): Promise<RouterResponse> {
  if (req.method !== "GET") {
    return { status: 405, body: { reason: "method_not_allowed" } };
  }

  // **One lookup against the route list decides the address.** Sixteen separate comparisons decided it before,
  // and the 404 was their negation — a seventeenth address could be recognised here and left out of that
  // negation, or the reverse. There is now a single answer, and whether this application has the address is
  // the same question as which address it is.
  const hit = matchRoute(req.path);
  if (hit === null) {
    return { status: 404, body: { reason: "not_found" } };
  }
  const at = (template: string): boolean => hit.template === template;
  /** The captured segment of this address, still percent-encoded — or null if we are elsewhere. */
  const segment = (template: string): string | null => (at(template) ? hit.captured : null);

  const isSession = at("/api/session");
  const isContracts = at("/api/contracts");
  const isOffers = at("/api/offers");
  const isTemplateCatalog = at("/api/catalog/templates");
  const isPackageCatalog = at("/api/catalog/packages");
  const isNode = at("/api/node");
  const isSearch = at("/api/search");
  const isUpdates = at("/api/updates");
  const isTimeline = at("/api/timeline");
  const isHoldings = at("/api/holdings");
  const isPreapprovals = at("/api/preapprovals");
  const isHome = at("/api/home");
  const detailMatch = segment("/api/contracts/{contractId}");
  const partyMatch = segment("/api/party/{partyId}");
  const updateByOffsetMatch = segment("/api/updates/by-offset/{offset}");
  const updateDetailMatch = segment("/api/updates/{updateId}");
  const schemaMatch = segment("/api/packages/{packageId}/schema");

  if (req.ledgerToken === null) {
    return { status: 401, body: { reason: "unauthenticated" } };
  }

  let decodedPartyId = "";
  if (partyMatch !== null) {
    const d = decodePathSegment(partyMatch);
    if (!d.ok) return { status: 400, body: { reason: "invalid_path" } };
    decodedPartyId = d.value;
  }
  let decodedContractId = "";
  if (detailMatch !== null) {
    const d = decodePathSegment(detailMatch);
    if (!d.ok) return { status: 400, body: { reason: "invalid_path" } };
    decodedContractId = d.value;
  }
  let decodedUpdateId = "";
  if (updateDetailMatch !== null) {
    const d = decodePathSegment(updateDetailMatch);
    if (!d.ok) return { status: 400, body: { reason: "invalid_path" } };
    decodedUpdateId = d.value;
  }

  // ── The shape of every query parameter is checked here, in one place ──────────────
  // **Scattered inside the handlers, validation gets skipped depending on which path was taken.** That
  // actually happened: `?limit=0` was a 400 but `?offset=0&limit=0` was a 200 — with offset 0 the query
  // range is empty, so the handler returned before calling core, and the limit check sat inside that.
  // Whether the shape is valid **must not depend on what is being queried.** So it is all checked here,
  // before any query starts. (Judging what a value *means* is still the handlers' and core's
  // job, below.)
  const bad = (reason: string): RouterResponse => ({ status: 400, body: { reason } });

  // Excludes the four paths that do not take an offset — their contracts have no invalid_offset.
  const takesOffset = !isSession && !isNode && schemaMatch === null && updateDetailMatch === null;
  if (
    takesOffset &&
    req.query.offset !== undefined &&
    !isNonNegativeIntegerString(req.query.offset)
  ) {
    return bad("invalid_offset");
  }

  // The path segment of a point lookup. Checked **before calling the ledger**: checked after obtaining the
  // viewer, a malformed request would make a round trip to the ledger anyway, and if the ledger failed in
  // the meantime a 502 or 504 would go out instead of a 400. Shape has nothing to do with the
  // ledger. (It comes after the 401, though — there is no reason to teach an unauthenticated request about
  // our input format.)
  if (updateDetailMatch !== null && !UPDATE_ID_SHAPE.test(decodedUpdateId)) {
    return bad("invalid_path");
  }
  // The ledger accepts only offsets **greater than 0** for this point lookup (NON_POSITIVE_OFFSET). And a
  // notation with leading zeros is forbidden by the document — this stops `0000000000000168` from being
  // accepted on the strength of its value alone.
  if (updateByOffsetMatch !== null && !isPositiveIntegerString(updateByOffsetMatch)) {
    return bad("invalid_offset");
  }

  if (isUpdates) {
    if (req.query.before !== undefined && !isNonNegativeIntegerString(req.query.before)) {
      return bad("invalid_before");
    }
    // 0 has no meaning — core rejects it with invalid_limit too. It is cut off here first.
    if (req.query.limit !== undefined && !isPositiveIntegerString(req.query.limit)) {
      return bad("invalid_limit");
    }
  }

  if (isTimeline && req.query.from !== undefined && !isNonNegativeIntegerString(req.query.from)) {
    return bad("invalid_offset");
  }

  if (isContracts) {
    if (req.query.pageSize !== undefined && !isPositiveIntegerString(req.query.pageSize)) {
      return bad("invalid_page_size");
    }
    if (
      req.query.cursorOffset !== undefined &&
      !isNonNegativeIntegerString(req.query.cursorOffset)
    ) {
      return bad("invalid_cursor");
    }
  }

  // The “now” for judging expiry is measured by the caller and passed in — this layer does not read a clock.
  // Absent is a 400, and **present but not an instant is also a 400** — never a 200 on an unreadable value.
  if (isOffers || isPreapprovals || isHome) {
    const asOf = req.query.asOf;
    if (asOf === undefined || !_isInstantString(asOf)) {
      return bad("invalid_as_of");
    }
  }

  // Interface ids. Required for offers, optional elsewhere. **The shape is checked too** —
  // three segments, `<package>:<Module>:<Entity>`, where the package is `#name` or 64 hex characters
  // (core's isWellFormedInterfaceId is the source of that rule — whether it exists is for the ledger to judge).
  // An empty string is not “absent”, and something without colons such as `__main__` is not an id either.
  // Both used to go straight to the ledger, the ledger rejected them, and that was reported as a 502
  // (a server fault).
  if (isOffers && req.query.interfaceId === undefined) {
    return bad("invalid_interface_id");
  }
  if (isOffers || isHome || isHoldings) {
    for (const id of [req.query.interfaceId, req.query.holdingInterfaceId]) {
      if (id !== undefined && !isWellFormedInterfaceId(id)) {
        return bad("invalid_interface_id");
      }
    }
  }

  // /api/node is an instance-level fact, so it needs no party/viewer.
  // currentObservedAtMs is required (the caller measures "now" and passes it in — this layer does not read the time).
  // priorOffset/priorObservedAtMs must both be present or both absent:
  //   - both absent means "not yet known" (first screen load) — not a 400.
  //   - only one present means the input format is incomplete — 400 (input validation, not a visibility judgment).
  let nodeCurrentObservedAtMs = 0;
  let nodePrior: NodeOffsetReading | undefined;
  let nodePriorObservedAtMs = 0;
  if (isNode) {
    if (
      req.query.currentObservedAtMs === undefined ||
      !isNonNegativeIntegerString(req.query.currentObservedAtMs)
    ) {
      return { status: 400, body: { reason: "invalid_observed_at" } };
    }
    nodeCurrentObservedAtMs = Number.parseInt(req.query.currentObservedAtMs, 10);
    // Take the values into local variables to narrow them. Previously this was checked with has* booleans, but the
    // type checker cannot connect the fact that the boolean is true with the fact that the value is not undefined. The
    // rule that both must be present or both absent (only one means 400) is unchanged.
    const priorOffset = req.query.priorOffset;
    const priorObservedAtMs = req.query.priorObservedAtMs;
    if ((priorOffset === undefined) !== (priorObservedAtMs === undefined)) {
      return { status: 400, body: { reason: "invalid_prior" } };
    }
    if (priorOffset !== undefined && priorObservedAtMs !== undefined) {
      if (
        !isNonNegativeIntegerString(priorOffset) ||
        !isNonNegativeIntegerString(priorObservedAtMs)
      ) {
        return { status: 400, body: { reason: "invalid_prior" } };
      }
      nodePrior = { status: "ok", offset: Number.parseInt(priorOffset, 10) };
      nodePriorObservedAtMs = Number.parseInt(priorObservedAtMs, 10);
    } else {
      // This reason string ("node_error") is an arbitrary constant — it means "never asked in the
      // first place", not an actual failure. computeInstanceLedgerEndProgress absorbs it as the
      // prior-unavailable case and settles elapsed as not-yet-known, so
      // this reason value is never exposed verbatim anywhere in the response.
      nodePrior = { status: "unavailable", reason: "node_error" };
      nodePriorObservedAtMs = 0;
    }
  }

  // Caller-bearer forwards the request-scoped token from Browser PKCE or an institution front unchanged.
  // Shared identity supplies a marker here; the selected transport replaces it with its service token.
  // This router neither acquires nor caches credentials; Canton validates the actual token and rights.
  const ledgerToken = req.ledgerToken;
  const send: LedgerSend = (request: LedgerRequest) => deps.send(withAuth(request, ledgerToken));

  if (isSearch) {
    // **The server builds the search results too** — type classification (classifySearchInput) looks only at the characters,
    // and the results are assembled by core (buildSearchResults) from the gathered materials (ACS·catalog·packages·point lookup). Empty input does not call the ledger.
    const q = req.query.q ?? "";
    const classification = classifySearchInput(q);
    const emptyMaterials = {
      contracts: [],
      templates: [],
      packages: { status: "ok" as const, packageIds: [] },
      packageNames: new Map<string, string>(),
      update: { status: "not_asked" as const },
    };
    if (classification.kind === "empty") {
      return {
        status: 200,
        body: {
          ...classification,
          results: buildSearchResults({ q, classification, ...emptyMaterials }),
        },
      };
    }
    const viewer = await resolveViewer(send);
    if (!viewer.ok) {
      return viewer.http;
    }
    if (viewer.kind === "no_party_rights") {
      return noPartyRights();
    }
    const offsetResult = await resolveOffset(send, req.query);
    if (!offsetResult.ok) {
      return offsetResult.http;
    }
    const acsResult: LedgerCallResult<unknown> = await callGetActiveContracts(
      send,
      viewer.filter,
      offsetResult.offset,
    );
    // An ACS failure does not kill the whole request — only the sections that come from contracts (Contracts·Parties·Templates) become unavailable with a reason,
    // and Updates (point lookup)·Packages (list) still answer (partial failures are exposed by name on that section).
    let acsDown: string | undefined;
    let contractRows: ReturnType<typeof toRawCreatedEvents> = { ok: true, rows: [] };
    if (!acsResult.ok) {
      acsDown = acsResult.reason;
    } else {
      const rows = toRawCreatedEvents(acsResult.value);
      if (!rows.ok) {
        acsDown = "node_error";
      } else {
        contractRows = rows;
      }
    }
    if (!contractRows.ok) {
      return { status: 502, body: { reason: "node_error" } };
    }
    const catalog = buildTemplateCatalog(contractRows.rows);
    const packageNames = new Map<string, string>();
    for (const row of contractRows.rows) {
      const parsed = parseTemplateFqn(row.templateId);
      if (parsed.ok) packageNames.set(parsed.package_name, row.packageName);
    }
    // The package list is asked only for name-like inputs — if it fails, only that section is unavailable (partial failures are not hidden).
    const nameLike =
      classification.kind === "template_or_interface_fqn" ||
      classification.kind === "interface_id_confirmed" ||
      classification.kind === "package_id" ||
      classification.kind === "unrecognized";
    let packages:
      | { status: "ok"; packageIds: string[] }
      | { status: "unavailable"; reason: string } = {
      status: "ok",
      packageIds: [],
    };
    if (nameLike) {
      const packagesResult: LedgerCallResult<unknown> = await callListPackages(send);
      if (!packagesResult.ok) {
        packages = { status: "unavailable", reason: packagesResult.reason };
      } else {
        const ids = (packagesResult.value as { packageIds?: unknown })?.packageIds;
        packages = Array.isArray(ids)
          ? { status: "ok", packageIds: ids.filter((x): x is string => typeof x === "string") }
          : { status: "unavailable", reason: "node_error" };
      }
    }
    // If it is an update id, point lookup — the failure name (not_found·pruned·others) is moved to the section as is.
    let update: Parameters<typeof buildSearchResults>[0]["update"] = { status: "not_asked" };
    if (classification.kind === "update_id") {
      const lookup: LedgerCallResult<unknown> = await callGetUpdateById(
        send,
        viewer.filter,
        classification.updateId,
      );
      if (!lookup.ok) {
        update =
          lookup.reason === "not_found" || lookup.reason === "pruned"
            ? { status: lookup.reason }
            : { status: "unavailable", reason: lookup.reason };
      } else {
        const detail = buildUpdateDetail(lookup.value, viewer.ownParties);
        update = detail.ok
          ? { status: "found", view: detail.view }
          : { status: "unavailable", reason: detail.reason };
      }
    }
    const results = buildSearchResults({
      q,
      classification,
      contracts: contractRows.rows,
      ...(acsDown !== undefined ? { contractsUnavailable: acsDown } : {}),
      templates: catalog.ok ? catalog.rows : [],
      packages,
      packageNames,
      update,
    });
    return {
      status: 200,
      body: {
        ...classification,
        results,
        offset: offsetResult.offset,
      },
    };
  }

  if (isHome) {
    // **The whole home is one offset.** Cards·sparkline·list all come out of this one
    // response, and the read time (readAt) is also stamped once on this one response by the boot file.
    //
    // Two layers of failure: ① if offset·user·rights cannot be obtained, the whole home “could not be fetched” — a one-offset
    // snapshot does not hold (via status code). ② the later pieces (ACS·interface ACS·updates) may fail to come, and then
    // only that card is unavailable and the rest stand (inside a 200, the “what it does not know” pattern of /api/node).
    const asOf = req.query.asOf as string;
    const offsetResult = await resolveOffset(send, req.query);
    if (!offsetResult.ok) {
      return offsetResult.http;
    }
    const userResult: LedgerCallResult<unknown> = await callGetAuthenticatedUser(send);
    if (!userResult.ok) {
      return ledgerFailureToHttp(userResult.reason);
    }
    const userValue = userResult.value as { user?: { id?: unknown } };
    const userId = typeof userValue?.user?.id === "string" ? userValue.user.id : "";
    const rightsResult: LedgerCallResult<unknown> = await callListUserRights(send, userId);
    if (!rightsResult.ok) {
      return ledgerFailureToHttp(rightsResult.reason);
    }
    const viewer = buildViewerParties(userResult.value, rightsResult.value);
    const ownParties = viewer.outcome === "view" ? viewer.parties.map((p) => p.party) : [];
    const offset = offsetResult.offset;
    // Where the recent window starts. The read below decides it (the window widens until it holds enough
    // of the viewer's transactions); until then, and when nothing is read, it is the first step's start.
    let beginExclusive = Math.max(0, offset - RECENT_UPDATES_LOOKBACK);
    // What to ask the ledger with, or null when there is nothing to ask. The same judgment resolveViewer
    // makes, and for the same reason: an empty party list is not by itself the absence of rights, because a
    // super reader holds no parties of their own and still reads every one of them. Without this the home
    // answered a super reader with a page of "no party rights" cards while its own viewer block, built from
    // the same `viewer`, reported their scope as instance-wide.
    const filter: LedgerPartyFilter | null =
      viewer.outcome !== "view"
        ? null
        : viewer.scope === "instance-wide"
          ? { anyParty: true }
          : ownParties.length > 0
            ? { parties: ownParties }
            : null;
    // When there is nothing to ask, the cards say so by name rather than carrying an empty filter to the
    // node — an empty filtersByParty is not an empty answer, it is a question that does not hold.
    let contracts: HomeSource<readonly unknown[]> = { ok: false, reason: "no_party_rights" };
    let offers: HomeSource<{ contracts: unknown; interfaceId: string }> = {
      ok: false,
      reason: "no_party_rights",
    };
    let holdings: HomeSource<{ contracts: unknown; interfaceId: string }> = {
      ok: false,
      reason: "no_party_rights",
    };
    let updates: HomeSource<unknown> = { ok: false, reason: "no_party_rights" };

    if (filter !== null) {
      contracts = await readHomeAcs(send, filter, offset, toContractListEntries);

      // The two interfaces are passed as constants by the screen (the standard interfaces the Explorer knows).
      // If not passed, that card becomes “could not be fetched” and says why by name.
      const offerInterfaceId = req.query.interfaceId;
      if (offerInterfaceId === undefined) {
        offers = { ok: false, reason: "interface_id_not_provided" };
      } else {
        const read = await readHomeAcs(send, filter, offset, toRawCreatedEvents, offerInterfaceId);
        offers = read.ok
          ? { ok: true, value: { contracts: read.value, interfaceId: offerInterfaceId } }
          : read;
      }
      const holdingInterfaceId = req.query.holdingInterfaceId;
      if (holdingInterfaceId === undefined) {
        holdings = { ok: false, reason: "holding_interface_id_not_provided" };
      } else {
        const read = await readHomeAcs(
          send,
          filter,
          offset,
          toRawCreatedEvents,
          holdingInterfaceId,
        );
        holdings = read.ok
          ? { ok: true, value: { contracts: read.value, interfaceId: holdingInterfaceId } }
          : read;
      }

      // An empty ledger (offset 0) has no range to ask about — the same rule as /api/updates.
      if (offset <= 0) {
        updates = { ok: true, value: [] };
      } else {
        const updatesResult = await callGetRecentUpdates(send, filter, offset);
        if (!updatesResult.ok) {
          updates = { ok: false, reason: updatesResult.reason };
        } else {
          beginExclusive = updatesResult.value.beginExclusive;
          const envelope = toUpdateEntries(updatesResult.value.updates);
          updates = envelope.ok
            ? { ok: true, value: envelope.rows }
            : { ok: false, reason: envelope.reason };
        }
      }
    }

    const summary = buildHomeSummary({
      offset,
      beginExclusive,
      viewer,
      asOf,
      contracts,
      offers,
      holdings,
      updates,
    });
    if (!summary.ok) {
      // The case where the viewer could not be computed — same treatment as resolveViewer (a data problem on the ledger side, 502).
      return { status: 502, body: { reason: "node_error" } };
    }
    return { status: 200, body: summary.summary };
  }

  if (isSession) {
    const userResult: LedgerCallResult<unknown> = await callGetAuthenticatedUser(send);
    if (!userResult.ok) {
      return ledgerFailureToHttp(userResult.reason);
    }
    const userValue = userResult.value as { user?: { id?: unknown } };
    const userId = typeof userValue?.user?.id === "string" ? userValue.user.id : "";
    const rightsResult: LedgerCallResult<unknown> = await callListUserRights(send, userId);
    if (!rightsResult.ok) {
      return ledgerFailureToHttp(rightsResult.reason);
    }
    const view = buildViewerParties(userResult.value, rightsResult.value);
    // What the token says about itself (issuer host · audience · expiry) — decoded only; the participant
    // already accepted it. Shared identity supplies a marker, so no service-token claims are decoded.
    // The token itself never goes back in the response — readTokenClaims returns those three and nothing else.
    const token = readTokenClaims(ledgerToken);
    if (view.outcome !== "view") return { status: 200, body: { ...view, token } };
    // The “details” fold of My parties: the **raw** rights per party are given along — they are the viewer's own, so no new permission is needed,
    // and it is copying, not judgment (up to and including picking out which party's they are and attaching them).
    const rightsRaw = (rightsResult.value as { rights?: unknown[] })?.rights;
    const rightsOf = (party: string): unknown[] =>
      Array.isArray(rightsRaw)
        ? rightsRaw.filter((r) => {
            const kind = (r as { kind?: Record<string, { value?: { party?: unknown } }> })?.kind;
            return kind !== undefined && Object.values(kind).some((k) => k?.value?.party === party);
          })
        : [];
    return {
      status: 200,
      body: {
        ...view,
        token,
        parties: view.parties.map((p) => ({ ...p, rights: rightsOf(p.party) })),
      },
    };
  }

  if (isContracts) {
    const offsetResult = await resolveOffset(send, req.query);
    if (!offsetResult.ok) {
      return offsetResult.http;
    }
    const viewer = await resolveViewer(send);
    if (!viewer.ok) {
      return viewer.http;
    }
    if (viewer.kind === "no_party_rights") {
      return noPartyRights();
    }
    const acsResult: LedgerCallResult<unknown> = await callGetActiveContracts(
      send,
      viewer.filter,
      offsetResult.offset,
    );
    if (!acsResult.ok) {
      return ledgerFailureToHttp(acsResult.reason);
    }
    const envelope = toContractListEntries(acsResult.value);
    if (!envelope.ok) {
      return { status: 502, body: { reason: "node_error" } };
    }
    const pageSize =
      req.query.pageSize !== undefined && isNonNegativeIntegerString(req.query.pageSize)
        ? Number.parseInt(req.query.pageSize, 10)
        : undefined;
    // The keyset cursor set (offset·createdAt·contractId) — the screen sends the response's nextCursor back as is. null for items that had no offset.
    const after =
      req.query.cursorCreatedAt !== undefined && req.query.cursorContractId !== undefined
        ? {
            offset:
              req.query.cursorOffset !== undefined &&
              isNonNegativeIntegerString(req.query.cursorOffset)
                ? Number.parseInt(req.query.cursorOffset, 10)
                : null,
            createdAt: req.query.cursorCreatedAt,
            contractId: req.query.cursorContractId,
          }
        : undefined;
    // Filters (template + one or more parties) are judged by core.
    const filterParties = parsePartyFilter(req.query.party);
    const filter = {
      ...(req.query.template !== undefined ? { template: req.query.template } : {}),
      ...(filterParties.length > 0 ? { parties: filterParties } : {}),
    };
    // Passes **all** of the viewer's parties. For a while only primaryParty was passed, and for someone
    // with several parties the rest of their own parties showed up as “counterparties” (constraint ① in packages/core/src/index.ts).
    // What is absent has no key at all (exactOptionalPropertyTypes).
    const listResult = buildContractList(envelope.rows, viewer.ownParties, {
      ...(pageSize !== undefined ? { pageSize } : {}),
      ...(after !== undefined ? { after } : {}),
      filter,
      readsAsAnyParty: viewer.scope === "instance-wide" && viewer.ownParties.length === 0,
    });
    if (!listResult.ok) {
      return { status: 502, body: { reason: "node_error" } };
    }
    return {
      status: 200,
      body: {
        ...listResult.page,
        offset: offsetResult.offset,
      },
    };
  }

  if (isUpdates) {
    if (req.query.limit !== undefined && !isNonNegativeIntegerString(req.query.limit)) {
      return { status: 400, body: { reason: "invalid_limit" } };
    }
    if (req.query.before !== undefined && !isNonNegativeIntegerString(req.query.before)) {
      return { status: 400, body: { reason: "invalid_before" } };
    }
    const viewer = await resolveViewer(send);
    if (!viewer.ok) {
      return viewer.http;
    }
    if (viewer.kind === "no_party_rights") {
      return noPartyRights();
    }
    const offsetResult = await resolveOffset(send, req.query);
    if (!offsetResult.ok) {
      return offsetResult.http;
    }
    // An empty ledger (offset 0) has no range to ask about — (0, 0] is not sent to the ledger; it is answered here.
    if (offsetResult.offset <= 0) {
      return {
        status: 200,
        body: {
          rows: [],
          offset: offsetResult.offset,
          beginExclusive: 0,
          total: 0,
          matched: 0,
          nextBefore: null,
          filter: {},
        },
      };
    }
    const updatesResult = await callGetRecentUpdates(send, viewer.filter, offsetResult.offset);
    if (!updatesResult.ok) {
      return ledgerFailureToHttp(updatesResult.reason);
    }
    const beginExclusive = updatesResult.value.beginExclusive;
    const envelope = toUpdateEntries(updatesResult.value.updates);
    if (!envelope.ok) {
      return { status: 502, body: { reason: "node_error" } };
    }
    // After standing up the whole range as rows (without cutting), filtering·paging is judged by core — template·parties·before·limit are all
    // passed through from the query as is. limit is the page size (default 25).
    const result = buildRecentUpdates(envelope.rows, { limit: Math.max(1, envelope.rows.length) });
    if (!result.ok) {
      return { status: 502, body: { reason: "node_error" } };
    }
    const limit = req.query.limit !== undefined ? Number.parseInt(req.query.limit, 10) : undefined;
    const before =
      req.query.before !== undefined ? Number.parseInt(req.query.before, 10) : undefined;
    const filterParties = parsePartyFilter(req.query.party);
    const paged = filterAndPageUpdates(
      result.rows,
      {
        ...(req.query.template !== undefined ? { template: req.query.template } : {}),
        ...(filterParties.length > 0 ? { parties: filterParties } : {}),
      },
      {
        ...(limit !== undefined ? { limit } : {}),
        ...(before !== undefined ? { before } : {}),
      },
    );
    if (!paged.ok) {
      // The case where limit is an integer but 0 or less — a problem of the input, not the ledger.
      if (paged.reason === "invalid_limit") {
        return { status: 400, body: { reason: "invalid_limit" } };
      }
      return { status: 400, body: { reason: paged.reason } };
    }
    // beginExclusive is given along — so the screen can say “how far back did we look for recent”.
    return {
      status: 200,
      body: {
        rows: paged.page.rows,
        offset: offsetResult.offset,
        beginExclusive,
        total: paged.page.total,
        matched: paged.page.matched,
        nextBefore: paged.page.nextBefore,
        filter: paged.page.filter,
      },
    };
  }

  if (isTimeline) {
    // **Contract lifetimes.** Two reads at one point: the recent window (what was created and archived in it)
    // and the active contracts (what is alive at that point). They must be the same offset — from two points
    // the ends of the bars would not line up, and a bar is exactly a claim about where a thing ended.
    //
    // The same template·party filter as the two lists, applied by the same core functions, so a Timeline
    // filtered to a party contains what the Transactions and Contracts lists contain for that party.
    const viewer = await resolveViewer(send);
    if (!viewer.ok) {
      return viewer.http;
    }
    if (viewer.kind === "no_party_rights") {
      return noPartyRights();
    }
    const offsetResult = await resolveOffset(send, req.query);
    if (!offsetResult.ok) {
      return offsetResult.http;
    }
    const end = offsetResult.offset;
    // **The window is [from, offset] — both ends included.** That is how the screen's two boxes read:
    // "from 50 to 50". (Exposing the ledger's own (begin, end] directly meant that an equal from and to gave
    // not a single point but an empty range, which came back as an error.) Only the ledger call uses an
    // exclusive start, and that conversion lives here in one place.
    const askedFrom = req.query.from !== undefined ? Number.parseInt(req.query.from, 10) : null;
    // A start past the end leaves no range to draw — that is a wrong input, not an empty answer. Equal is
    // a single point.
    if (askedFrom !== null && askedFrom > end && end > 0) {
      return { status: 400, body: { reason: "invalid_window" } };
    }
    if (askedFrom !== null && end - askedFrom + 1 > TIMELINE_MAX_SPAN) {
      return { status: 400, body: { reason: "window_too_wide" } };
    }
    const filterParties = parsePartyFilter(req.query.party);
    const filter = {
      ...(req.query.template !== undefined ? { template: req.query.template } : {}),
      ...(filterParties.length > 0 ? { parties: filterParties } : {}),
    };
    // An empty ledger has no range to ask about — the same answer /api/updates gives at offset 0.
    if (end <= 0) {
      return {
        status: 200,
        body: { groups: [], total: 0, offset: end, from: 0, filter },
      };
    }
    // A chosen start is read as chosen; an unchosen one is the recent window, and the read that finds it
    // is the read of the window — one ledger walk, not two.
    let from: number;
    let updatesRaw: unknown;
    if (askedFrom !== null) {
      const updatesResult = await callGetUpdates(
        send,
        viewer.filter,
        Math.max(0, askedFrom - 1),
        end,
      );
      if (!updatesResult.ok) {
        return ledgerFailureToHttp(updatesResult.reason);
      }
      from = askedFrom;
      updatesRaw = updatesResult.value;
    } else {
      const recent = await callGetRecentUpdates(send, viewer.filter, end);
      if (!recent.ok) {
        return ledgerFailureToHttp(recent.reason);
      }
      from = recent.value.beginExclusive + 1;
      updatesRaw = recent.value.updates;
    }
    const updateEnvelope = toUpdateEntries(updatesRaw);
    if (!updateEnvelope.ok) {
      return { status: 502, body: { reason: "node_error" } };
    }
    const recent = buildRecentUpdates(updateEnvelope.rows, {
      limit: Math.max(1, updateEnvelope.rows.length),
    });
    if (!recent.ok) {
      return { status: 502, body: { reason: "node_error" } };
    }
    // The whole window, not a page — a timeline draws a range. limit is the row count itself.
    const paged = filterAndPageUpdates(recent.rows, filter, {
      limit: Math.max(1, recent.rows.length),
    });
    if (!paged.ok) {
      return { status: 400, body: { reason: paged.reason } };
    }
    const acsResult: LedgerCallResult<unknown> = await callGetActiveContracts(
      send,
      viewer.filter,
      end,
    );
    if (!acsResult.ok) {
      return ledgerFailureToHttp(acsResult.reason);
    }
    const acsEnvelope = toContractListEntries(acsResult.value);
    if (!acsEnvelope.ok) {
      return { status: 502, body: { reason: "node_error" } };
    }
    // pageSize is the whole of the visible set for the same reason as above.
    const listResult = buildContractList(acsEnvelope.rows, viewer.ownParties, {
      pageSize: Math.max(1, acsEnvelope.rows.length),
      filter,
      readsAsAnyParty: viewer.scope === "instance-wide" && viewer.ownParties.length === 0,
    });
    if (!listResult.ok) {
      return { status: 502, body: { reason: "node_error" } };
    }
    const groups = groupLifelines(
      buildLifelines(paged.page.rows, listResult.page.rows, { from, to: end }),
    );
    return {
      status: 200,
      body: {
        groups,
        total: groups.reduce((n, g) => n + g.lines.length, 0),
        offset: end,
        from,
        filter: paged.page.filter,
      },
    };
  }

  if (schemaMatch !== null) {
    // The schema is the same value for everyone, but downloading the package requires a token — this route also sits behind the 401.
    const source = await loadSchema(send, schemaMatch);
    if (source.status !== "ok") {
      // The reason it could not be read, as is — an unsupported LF version (unsupported_lf_version:1.x) is not a 502 but a circumstance inside a 200: the node is fine.
      if (
        source.reason.startsWith("unsupported_lf_version") ||
        source.reason.startsWith("decode_failed") ||
        !isLedgerReason(source.reason)
      ) {
        return {
          status: 200,
          body: { status: "unavailable", reason: source.reason, packageId: schemaMatch },
        };
      }
      return ledgerFailureToHttp(source.reason as Parameters<typeof ledgerFailureToHttp>[0]);
    }
    return { status: 200, body: { status: "ok", ...source.schema } };
  }

  if (updateDetailMatch !== null || updateByOffsetMatch !== null) {
    // **Update detail is a point lookup** (LEDGER_EFFECTS) — even outside the list range it opens as long as the participant retains it. A pruned past is
    // named pruned (410) by core, and absent or not visible is a single 404 (the v1 rule of not distinguishing “absent” from “cannot see”).
    const viewer = await resolveViewer(send);
    if (!viewer.ok) {
      return viewer.http;
    }
    if (viewer.kind === "no_party_rights") {
      return noPartyRights();
    }
    const lookup: LedgerCallResult<unknown> =
      updateByOffsetMatch !== null
        ? await callGetUpdateByOffset(send, viewer.filter, Number.parseInt(updateByOffsetMatch, 10))
        : await callGetUpdateById(send, viewer.filter, decodedUpdateId);
    if (!lookup.ok) {
      return ledgerFailureToHttp(lookup.reason);
    }
    const detail = buildUpdateDetail(lookup.value, viewer.ownParties);
    if (!detail.ok) {
      return { status: 502, body: { reason: "node_error" } };
    }
    // decoder landing point 2: attaches argument names·types to the choice of Exercised events. If the schema cannot be read, only that event goes without (Raw as is).
    let events: unknown = detail.view.kind === "transaction" ? detail.view.events : [];
    if (detail.view.kind === "transaction") {
      const withSchema = [];
      for (const e of detail.view.events) {
        let choiceSchema: unknown = null;
        let templateSchema: unknown = null;
        const source = await loadSchema(send, e.package);
        if (source.status === "ok") {
          const t = findTemplate(source.schema, e.module, e.entity);
          if (t !== null) {
            templateSchema = { fields: t.fields.map((f) => ({ name: f.name, type: f.type })) };
            if (e.kind === "exercised" && e.choice !== null) {
              const c = t.choices.find((x) => x.name === e.choice) ?? null;
              choiceSchema =
                c === null
                  ? null
                  : {
                      consuming: c.consuming,
                      argType: c.argType,
                      argFields: c.argFields?.map((f) => ({ name: f.name, type: f.type })) ?? null,
                      returnType: c.returnType,
                    };
            }
            if (e.kind === "created") {
              templateSchema = {
                ...(templateSchema as object),
                typedPayload: typeRecordFields(
                  e.createArgument,
                  t.fields,
                  source.schema,
                  cachedLookup,
                ),
              };
            }
          }
        }
        withSchema.push({
          ...e,
          choiceSchema,
          templateSchema,
          schemaStatus: source.status === "ok" ? "ok" : source.reason,
        });
      }
      events = withSchema;
    }
    return {
      status: 200,
      body: {
        ...detail.view,
        ...(detail.view.kind === "transaction" ? { events } : {}),
      },
    };
  }

  if (isHoldings || isPreapprovals) {
    const viewer = await resolveViewer(send);
    if (!viewer.ok) {
      return viewer.http;
    }
    if (viewer.kind === "no_party_rights") {
      return noPartyRights();
    }
    const offsetResult = await resolveOffset(send, req.query);
    if (!offsetResult.ok) {
      return offsetResult.http;
    }
    // Holdings queries by **interface view** when the screen passes the standard Holding interface id (the same technique as the home card).
    // If not passed (old callers·test stacks), the adapter picks by template from the full ACS. TransferPreapproval has no interface, so it is always the latter.
    const holdingInterfaceId = isHoldings ? req.query.holdingInterfaceId : undefined;
    const acsResult: LedgerCallResult<unknown> = await callGetActiveContracts(
      send,
      viewer.filter,
      offsetResult.offset,
      holdingInterfaceId,
    );
    if (!acsResult.ok) {
      return ledgerFailureToHttp(acsResult.reason);
    }
    if (holdingInterfaceId !== undefined) {
      const viewRows = toRawCreatedEvents(acsResult.value);
      if (!viewRows.ok) {
        return { status: 502, body: { reason: "node_error" } };
      }
      const result = buildTokenHoldings(viewRows.rows, viewer.ownParties, { holdingInterfaceId });
      return {
        status: 200,
        body: { ...result, offset: offsetResult.offset },
      };
    }
    const envelope = toLedgerAcsEntries(acsResult.value);
    if (!envelope.ok) {
      return { status: 502, body: { reason: "node_error" } };
    }
    const entries = envelope.rows.map((row) => ({
      contractId: row.contractId,
      templateId: row.entry.templateId,
      packageName: row.entry.packageName,
      createArgument: row.entry.createArgument,
    }));
    // The viewer parties must be passed so that “is it mine” is put in the value — the same reason as the direction of offers.
    // It is the final value on which core has already finished judging — even if unavailable, it is carried in a 200 as is.
    const result = isHoldings
      ? buildTokenHoldings(entries, viewer.ownParties)
      : buildTransferPreapprovals(entries, req.query.asOf as string, viewer.ownParties);
    return {
      status: 200,
      body: { ...result, offset: offsetResult.offset },
    };
  }

  if (isOffers) {
    const interfaceId = req.query.interfaceId as string;
    const asOf = req.query.asOf as string;
    const viewer = await resolveViewer(send);
    if (!viewer.ok) {
      return viewer.http;
    }
    if (viewer.kind === "no_party_rights") {
      return noPartyRights();
    }
    const offsetResult = await resolveOffset(send, req.query);
    if (!offsetResult.ok) {
      return offsetResult.http;
    }
    const acsResult: LedgerCallResult<unknown> = await callGetActiveContracts(
      send,
      viewer.filter,
      offsetResult.offset,
      interfaceId,
    );
    if (!acsResult.ok) {
      return ledgerFailureToHttp(acsResult.reason);
    }
    const envelope = toRawCreatedEvents(acsResult.value);
    if (!envelope.ok) {
      return { status: 502, body: { reason: "node_error" } };
    }
    // The viewer parties must be passed so that the direction (received or sent) is put in the value. If not passed, core
    // answers unknown, and then the screen ends up judging again — preventing that is what this argument is for.
    const result = buildTransferOffers(envelope.rows, interfaceId, asOf, viewer.ownParties);
    // It is the final value on which core has already finished judging — even if kind:"unavailable" it is not
    // turned into a 502 but carried in a 200 as is.
    return { status: 200, body: result };
  }

  if (isTemplateCatalog) {
    const viewer = await resolveViewer(send);
    if (!viewer.ok) {
      return viewer.http;
    }
    if (viewer.kind === "no_party_rights") {
      return noPartyRights();
    }
    const offsetResult = await resolveOffset(send, req.query);
    if (!offsetResult.ok) {
      return offsetResult.http;
    }
    const acsResult: LedgerCallResult<unknown> = await callGetActiveContracts(
      send,
      viewer.filter,
      offsetResult.offset,
    );
    if (!acsResult.ok) {
      return ledgerFailureToHttp(acsResult.reason);
    }
    const envelope = toRawCreatedEvents(acsResult.value);
    if (!envelope.ok) {
      return { status: 502, body: { reason: "node_error" } };
    }
    const result = buildTemplateCatalog(envelope.rows);
    if (!result.ok) {
      return { status: 502, body: { reason: "node_error" } };
    }
    // decoder landing point 4: a definition per row (fields·choices·implements) — from that template's package schema. If it cannot be read, only the reason.
    const rows = [];
    for (const row of result.rows) {
      const source = await loadSchema(send, row.packageId);
      const t = source.status === "ok" ? findTemplate(source.schema, row.module, row.entity) : null;
      rows.push({
        ...row,
        definition:
          source.status !== "ok"
            ? { status: "unavailable", reason: source.reason }
            : t === null
              ? { status: "unavailable", reason: "template_not_in_package" }
              : {
                  status: "ok",
                  packageVersion: source.schema.version,
                  fields: t.fields.map((f) => ({ name: f.name, type: f.type })),
                  choices: t.choices.map((c) => ({
                    name: c.name,
                    consuming: c.consuming,
                    argType: c.argType,
                    argFields: c.argFields?.map((f) => ({ name: f.name, type: f.type })) ?? null,
                    returnType: c.returnType,
                  })),
                  key: t.key,
                  implements: t.implements,
                },
      });
    }
    return { status: 200, body: { ...result, rows } };
  }

  if (isPackageCatalog) {
    const viewer = await resolveViewer(send);
    if (!viewer.ok) {
      return viewer.http;
    }
    if (viewer.kind === "no_party_rights") {
      return noPartyRights();
    }
    const offsetResult = await resolveOffset(send, req.query);
    if (!offsetResult.ok) {
      return offsetResult.http;
    }
    const acsResult: LedgerCallResult<unknown> = await callGetActiveContracts(
      send,
      viewer.filter,
      offsetResult.offset,
    );
    if (!acsResult.ok) {
      return ledgerFailureToHttp(acsResult.reason);
    }
    const envelope = toRawCreatedEvents(acsResult.value);
    if (!envelope.ok) {
      return { status: 502, body: { reason: "node_error" } };
    }
    // Collects only the packageId (hash) segments of the templateIds my active contracts reference.
    // The packages of interfaceViews[].interfaceId are not included — that is the package of an
    // interface the contract "references", not the contract's own template package.
    // Rows that fail to parse are silently skipped, since this is not a judgment but an aggregation of the packageIds that exist.
    // Names are known only for the packages my contracts use, via the ACS's packageName — layer 1's ListPackages gives only ids.
    const myPackageIds = new Set<string>();
    const namesByPackageId = new Map<string, string>();
    for (const row of envelope.rows) {
      const parsed = parseTemplateFqn(row.templateId);
      if (parsed.ok) {
        myPackageIds.add(parsed.package_name);
        namesByPackageId.set(parsed.package_name, row.packageName);
      }
    }
    const packagesResult: LedgerCallResult<unknown> = await callListPackages(send);
    if (!packagesResult.ok) {
      return ledgerFailureToHttp(packagesResult.reason);
    }
    const result = buildPackageCatalog(packagesResult.value, myPackageIds, namesByPackageId);
    if (!result.ok) {
      return { status: 502, body: { reason: "node_error" } };
    }
    // decoder landing point 3: name·version·table of contents of every installed package — downloaded·decoded sequentially once at first, then cached. Packages whose
    // schema could not be read (LF 1.x etc.) keep the “not in this layer” marking as is, with the reason attached.
    const rows = [];
    for (const row of result.rows) {
      const source = await loadSchema(send, row.packageId);
      rows.push(
        source.status === "ok"
          ? {
              ...row,
              name: source.schema.name ?? row.name,
              version: source.schema.version ?? row.version,
              lfVersion: source.schema.lfVersion,
              schemaStatus: "ok",
              templates: source.schema.modules.flatMap((m) =>
                m.templates.map((t) => ({
                  module: m.name,
                  name: t.name,
                  choices: t.choices.length,
                })),
              ),
              interfaces: source.schema.modules.flatMap((m) =>
                m.interfaces.map((i) => ({ module: m.name, name: i.name })),
              ),
            }
          : { ...row, schemaStatus: source.reason, templates: [], interfaces: [] },
      );
    }
    return { status: 200, body: { ...result, rows } };
  }

  if (isNode) {
    const currentEndResult: LedgerCallResult<unknown> = await callGetLedgerEnd(send);
    let current: NodeOffsetReading;
    if (!currentEndResult.ok) {
      // Authentication failure must not hide inside partial 200 data. Caller-bearer exposes 401
      // for login recovery; the shared-identity HTTP boundary instead maps its transport failure
      // to operational 503 and invalidates the service cache, without asking an end user to log in.
      // Previously the 200 also exposed participant version/features after a token rejection.
      if (currentEndResult.reason === "unauthenticated") {
        return { status: 401, body: { reason: "unauthenticated" } };
      }
      // Every other failure is embedded in the 200 as this screen is designed — /api/node is a status screen
      // that reports “what it does not know”. The actual failure cause is preserved as is and not promoted to
      // a top-level 502/504 (unlike the immediate-error pattern of offset/session/contracts).
      current = { status: "unavailable", reason: currentEndResult.reason };
    } else {
      const value = currentEndResult.value as { offset?: unknown };
      current =
        typeof value?.offset === "number"
          ? { status: "ok", offset: value.offset }
          : { status: "unavailable", reason: "node_error" };
    }
    const versionResult = await callGetVersion(send);
    const snapshot = buildNodeStatusSnapshot(
      nodePrior as NodeOffsetReading,
      nodePriorObservedAtMs,
      current,
      nodeCurrentObservedAtMs,
      versionResult,
    );
    // The Ledger end of this screen is **the value this call read** — drawing another read's offset in its place would mask a read failure behind a number.
    return { status: 200, body: { ...snapshot, ledgerEnd: current } };
  }

  if (partyMatch !== null) {
    const partyId = decodedPartyId;
    const offsetResult = await resolveOffset(send, req.query);
    if (!offsetResult.ok) {
      return offsetResult.http;
    }
    const viewer = await resolveViewer(send);
    if (!viewer.ok) {
      return viewer.http;
    }
    if (viewer.kind === "no_party_rights") {
      return noPartyRights();
    }
    const acsResult: LedgerCallResult<unknown> = await callGetActiveContracts(
      send,
      viewer.filter,
      offsetResult.offset,
    );
    if (!acsResult.ok) {
      return ledgerFailureToHttp(acsResult.reason);
    }
    const result = searchPartyInActiveContracts(acsResult.value, partyId);
    if (result.status === "invalid_input") {
      return { status: 502, body: { reason: "node_error" } };
    }
    return {
      status: 200,
      body: {
        ...result,
        offset: offsetResult.offset,
      },
    };
  }

  // detailMatch !== null is the only remaining path that reaches here.
  const contractId = decodedContractId;
  const offsetResult = await resolveOffset(send, req.query);
  if (!offsetResult.ok) {
    return offsetResult.http;
  }
  const viewer = await resolveViewer(send);
  if (!viewer.ok) {
    return viewer.http;
  }
  if (viewer.kind === "no_party_rights") {
    return noPartyRights();
  }
  const acsResult: LedgerCallResult<unknown> = await callGetActiveContracts(
    send,
    viewer.filter,
    offsetResult.offset,
  );
  if (!acsResult.ok) {
    return ledgerFailureToHttp(acsResult.reason);
  }
  const envelope = toLedgerAcsEntries(acsResult.value);
  if (!envelope.ok) {
    return { status: 502, body: { reason: "node_error" } };
  }
  const found = envelope.rows.find((row) => row.contractId === contractId);
  if (!found) {
    // The layer 1 response does not fully carry the material for stakeholder classification (witnesses/divulged_only),
    // so "absent" and "cannot see (outside visibility)" cannot be told apart. That is why this one spot is
    // the only undistinguished point, and it gives a single answer (404 not_found).
    return { status: 404, body: { reason: "not_found" } };
  }
  // seenBy is **my** parties that see this contract (witnessParties = the parties among those requested that see it).
  const detailResult = buildContractDetail(found.entry, viewer.ownParties);
  if (!detailResult.ok) {
    return { status: 502, body: { reason: "node_error" } };
  }
  // decoder landing point 1: this contract's template definition (choices·field types) and the typed payload. If the schema cannot be read, only the reason — the Raw JSON stays as is.
  const source = await loadSchema(send, detailResult.view.packageId);
  let schema: unknown = {
    status: "unavailable",
    reason: source.status === "ok" ? "template_not_in_package" : source.reason,
  };
  if (source.status === "ok") {
    const t = findTemplate(source.schema, detailResult.view.module, detailResult.view.entity);
    if (t !== null) {
      schema = {
        status: "ok",
        lfVersion: source.schema.lfVersion,
        packageName: source.schema.name,
        packageVersion: source.schema.version,
        fields: t.fields.map((f) => ({ name: f.name, type: f.type })),
        choices: t.choices.map((c) => ({
          name: c.name,
          consuming: c.consuming,
          argType: c.argType,
          argFields: c.argFields?.map((f) => ({ name: f.name, type: f.type })) ?? null,
          returnType: c.returnType,
        })),
        key: t.key,
        implements: t.implements,
        typedPayload: typeRecordFields(
          detailResult.view.createArgument,
          t.fields,
          source.schema,
          cachedLookup,
        ),
      };
    }
  }
  return {
    status: 200,
    body: {
      ...detailResult.view,
      schema,
    },
  };
}

function isLedgerReason(reason: string): boolean {
  return [
    "unauthenticated",
    "forbidden",
    "not_found",
    "node_error",
    "unreachable",
    "pruned",
  ].includes(reason);
}
