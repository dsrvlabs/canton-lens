import assert from "node:assert/strict";
import { test } from "node:test";
import type { LedgerRequest } from "@canton-lens/core";
import { _isInstantString, routeRequest } from "./router.ts";

// The judgment of whether the reference instant for expiry (`asOf`) really is an instant. The document says
// `format: date-time` (RFC 3339), so that much is checked.
//
// **Why so many small branches.** `Date.parse` alone lets through inputs that quietly become a different
// instant. It is the kind where **the computed result** is wrong rather than the status code, so what a value
// that passed actually means matters.

test("a complete instant with a timezone passes", () => {
  for (const good of [
    "2026-09-06T12:00:00Z",
    "2026-09-06T12:00:00.123Z",
    "2026-09-06T12:00:00+09:00",
    "2026-09-06T12:00:00-05:30",
  ]) {
    assert.equal(_isInstantString(good), true, good);
  }
});

test("no timezone is refused — without one it reads in the server's timezone and the answer differs per machine", () => {
  assert.equal(_isInstantString("2026-09-06T12:00:00"), false);
  assert.equal(_isInstantString("2026-09-06T12:00:00.123"), false);
});

test("no seconds is refused — Date.parse accepts it, but it is not the shape the document states", () => {
  assert.equal(_isInstantString("2026-09-06T12:00Z"), false);
  assert.equal(_isInstantString("2026-09-06T12:00"), false);
});

test("a date alone, or a year alone, is refused", () => {
  for (const bad of ["2026", "2026-09", "2026-09-06", ""]) {
    assert.equal(_isInstantString(bad), false, `"${bad}"`);
  }
});

test("a day that does not exist on the calendar is refused — Date.parse rolls it into the next month and accepts", () => {
  // 2026-02-30 parses as March 2. This stops it from quietly becoming a different instant.
  assert.equal(new Date("2026-02-30T00:00:00Z").toISOString().slice(0, 10), "2026-03-02");
  assert.equal(_isInstantString("2026-02-30T00:00:00Z"), false);
  assert.equal(_isInstantString("2026-04-31T00:00:00Z"), false);
  assert.equal(_isInstantString("2026-00-01T00:00:00Z"), false);
  assert.equal(_isInstantString("2026-09-00T00:00:00Z"), false);
});

test("leap years follow the real calendar", () => {
  assert.equal(_isInstantString("2026-02-29T00:00:00Z"), false, "2026 is not a leap year");
  assert.equal(_isInstantString("2028-02-29T00:00:00Z"), true, "2028 is a leap year");
  assert.equal(_isInstantString("2000-02-29T00:00:00Z"), true, "divisible by 400, so a leap year");
  assert.equal(_isInstantString("1900-02-29T00:00:00Z"), false, "divisible by 100, so not one");
});

test("out-of-range hours, minutes and seconds are filtered by Date.parse", () => {
  for (const bad of [
    "2026-13-01T00:00:00Z",
    "2026-09-06T24:00:01Z",
    "2026-09-06T12:60:00Z",
    "2026-09-06T12:00:00+99:00",
  ]) {
    assert.equal(_isInstantString(bad), false, bad);
  }
});

test("text that is not an instant is refused — `null` passing with a 200 is the reason this judgment exists", () => {
  for (const bad of ["null", "undefined", "sometime", "NaN", "0"]) {
    assert.equal(_isInstantString(bad), false, bad);
  }
});

// ── A viewer with no party rights ────────────────────────────────────────────────
//
// A ledger user that holds neither CanReadAs nor CanActAs has no party filter to query with. The
// routes used to send the empty filter anyway; the participant rejected it, and this layer could only
// read that rejection as node_error (502) — "the node refused", about a node that was fine. These
// routes now answer 403 no_party_rights without asking the participant.

// Answers only the three calls that do not carry a party filter. Anything else is recorded, so a route
// that still reaches the ledger fails here by name rather than by a confusing status code.
const viewerWithoutParties = (asked: string[]) => async (request: LedgerRequest) => {
  asked.push(`${request.method} ${request.path}`);
  if (request.path === "/v2/authenticated-user") {
    return { status: 200, body: { user: { id: "viewer", primaryParty: "" } } };
  }
  if (request.path === "/v2/users/viewer/rights") {
    // The shape that produces this: an administrative right over the identity provider, and no party
    // right at all. A ledger user can hold one without holding any CanReadAs or CanActAs.
    return { status: 200, body: { rights: [{ kind: { IdentityProviderAdmin: { value: {} } } }] } };
  }
  if (request.path === "/v2/state/ledger-end") {
    return { status: 200, body: { offset: 12 } };
  }
  // The party-filtered calls. Reaching one of them is the bug.
  return { status: 400, body: { cause: "the party filter was empty" } };
};

const ask = async (path: string, query: Record<string, string> = {}) => {
  const asked: string[] = [];
  const response = await routeRequest(
    { method: "GET", path, query, ledgerToken: "token" },
    { send: viewerWithoutParties(asked) },
  );
  return { response, asked };
};

const INSTANT = "2026-09-14T00:00:00Z";
const HOLDING_INTERFACE = "#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding";
const UPDATE_ID = `1220${"a".repeat(64)}`;

// Every route that queries with the viewer's party filter.
const PARTY_SCOPED: [string, Record<string, string>][] = [
  ["/api/contracts", {}],
  ["/api/contracts/00abcd", {}],
  ["/api/updates", {}],
  [`/api/updates/${UPDATE_ID}`, {}],
  ["/api/updates/by-offset/5", {}],
  ["/api/timeline", {}],
  ["/api/holdings", {}],
  ["/api/preapprovals", { asOf: INSTANT }],
  ["/api/offers", { asOf: INSTANT, interfaceId: HOLDING_INTERFACE }],
  ["/api/catalog/templates", {}],
  ["/api/catalog/packages", {}],
  ["/api/search", { q: "Alice" }],
  ["/api/party/Alice::1220ab", {}],
];

test("a viewer with no party rights gets 403 no_party_rights, not 502 node_error", async () => {
  for (const [path, query] of PARTY_SCOPED) {
    const { response } = await ask(path, query);
    assert.equal(response.status, 403, path);
    assert.deepEqual(response.body, { reason: "no_party_rights" }, path);
  }
});

test("no party-filtered request is sent — the participant is never asked with an empty filter", async () => {
  for (const [path, query] of PARTY_SCOPED) {
    const { asked } = await ask(path, query);
    assert.deepEqual(
      asked.filter(
        (call) =>
          !call.endsWith("/v2/authenticated-user") &&
          !call.endsWith("/v2/state/ledger-end") &&
          !call.endsWith("/v2/users/viewer/rights"),
      ),
      [],
      `${path} still reached the ledger`,
    );
  }
});

test("/api/session is unchanged — reporting a viewer with no parties is its job", async () => {
  const { response } = await ask("/api/session");
  assert.equal(response.status, 200);
  const body = response.body as { outcome: string; parties: unknown[] };
  assert.equal(body.outcome, "view");
  assert.deepEqual(body.parties, []);
});

test("/api/home is unchanged — it names the circumstance inside a 200", async () => {
  const { response } = await ask("/api/home", { asOf: INSTANT });
  assert.equal(response.status, 200);
  const body = response.body as { cards: { status: string } };
  assert.equal(body.cards.status, "no_party_rights");
});

// ── A viewer who reads as every party ────────────────────────────────────────────
//
// A ledger user holding CanReadAsAnyParty holds no party of their own and reads all of them. Judging on
// the empty party list alone answered them 403 no_party_rights — a response identical, byte for byte, to a
// viewer holding nothing — while the screen above it displayed a "whole instance" badge.
//
// Measured against Canton 3.5.15 on 2026-09-15, on the local test stack: the same token and the same
// request, 403 without the right and 200 with it, returning 40 elements where the viewer's own parties
// returned 9. ParticipantAdmin was measured separately and does **not** serve the request — see below.

const rightsOnly =
  (right: unknown, asked: string[], bodies: unknown[]) => async (request: LedgerRequest) => {
    asked.push(`${request.method} ${request.path}`);
    bodies.push(request.body);
    if (request.path === "/v2/authenticated-user") {
      return { status: 200, body: { user: { id: "viewer", primaryParty: "" } } };
    }
    if (request.path === "/v2/users/viewer/rights") {
      return { status: 200, body: { rights: Array.isArray(right) ? right : [right] } };
    }
    if (request.path === "/v2/state/ledger-end") {
      return { status: 200, body: { offset: 12 } };
    }
    // The point lookups do not answer with a list, and handing them one would fail the route for a reason
    // that has nothing to do with the viewer — the node's own name for "no such update" is what it sends.
    if (request.path.startsWith("/v2/updates/update-by-")) {
      return { status: 404, body: { code: "UPDATE_NOT_FOUND" } };
    }
    // Nor does the package list. Its shape is an object, and a route handed an array here fails for a
    // reason that says nothing about which viewer asked.
    if (request.path === "/v2/packages") {
      return { status: 200, body: { packageIds: [] } };
    }
    // Every list the super reader is entitled to ask for. Empty is a complete answer, and it ends the
    // pagination walk, so the routes get to build a real response rather than a failure.
    return { status: 200, body: [] };
  };

const SUPER_READER = { kind: { CanReadAsAnyParty: { value: {} } } };
const PARTICIPANT_ADMIN = { kind: { ParticipantAdmin: { value: {} } } };
const OWN_PARTY = { kind: { CanReadAs: { value: { party: "alice::1220ab" } } } };

const askAs = async (right: unknown, path: string, query: Record<string, string> = {}) => {
  const asked: string[] = [];
  const bodies: unknown[] = [];
  const response = await routeRequest(
    { method: "GET", path, query, ledgerToken: "token" },
    { send: rightsOnly(right, asked, bodies) },
  );
  return { response, asked, bodies };
};

test("a viewer who reads as every party is served, not merely un-refused", async () => {
  // **Asserting "not 403" is not enough**, and saying so here because that weaker assertion is what let a
  // real defect through: /api/contracts and /api/timeline answered 502, because buildContractList rejects
  // an empty viewer list as a missing argument — the one viewer for whom it is the answer.
  //
  // 403 is the refusal this change exists to remove; 502 is this layer calling a working node broken.
  // Neither is an outcome this viewer may receive on any of these routes.
  for (const [path, query] of PARTY_SCOPED) {
    const { response } = await askAs(SUPER_READER, path, query);
    assert.notEqual(response.status, 403, `${path} shut out a viewer who can read everything`);
    assert.notEqual(response.status, 502, `${path} reported a working node as broken`);
  }

  // The routes that answer with a list have a list to answer with, so for them the outcome is 200 exactly.
  // The point lookups are left out on purpose: against a stub holding nothing, 404 is the honest answer.
  const LIST_ROUTES = PARTY_SCOPED.filter(
    ([path]) => !/\/api\/(contracts\/|updates\/|party\/)/.test(path),
  );
  assert.ok(LIST_ROUTES.length > 0);
  for (const [path, query] of LIST_ROUTES) {
    const { response } = await askAs(SUPER_READER, path, query);
    assert.equal(response.status, 200, `${path} answered ${response.status}, not 200`);
  }
});

test("holding a party of one's own as well does not narrow a super reader", async () => {
  // Both rights at once. The party list is not empty, so a filter chosen on the list would quietly send
  // filtersByParty and return a fraction of what this viewer may read, under a "whole instance" badge.
  const { bodies } = await askAs([SUPER_READER, OWN_PARTY], "/api/contracts");
  const acs = bodies.find(
    (b): b is { filter: { filtersByParty: unknown; filtersForAnyParty?: unknown } } =>
      typeof b === "object" && b !== null && "filter" in b,
  );
  assert.ok(acs, "no active-contracts request was sent");
  assert.ok(
    acs.filter.filtersForAnyParty !== undefined,
    "the request was narrowed to their own parties",
  );
  assert.deepEqual(acs.filter.filtersByParty, {});
});

test("a right whose payload is not the shape the node sends does not grant instance-wide reads", async () => {
  // `CanReadAsAnyParty` carries a value object, like CanReadAs and CanActAs. Accepting the bare key meant
  // a malformed rights response could make this layer ask on behalf of a viewer whose rights never said so.
  // Both levels are covered: the primitives, and the shapes that pass a check of the outer level alone.
  for (const malformed of [null, false, "yes", 1, {}, [], { value: null }, { value: "x" }]) {
    const { response } = await askAs({ kind: { CanReadAsAnyParty: malformed } }, "/api/contracts");
    assert.equal(response.status, 403, `${JSON.stringify(malformed)} was read as a right`);
    assert.deepEqual(response.body, { reason: "no_party_rights" });
  }
  // The shape the node does send is still read as the right it is.
  const { response } = await askAs(SUPER_READER, "/api/contracts");
  assert.equal(response.status, 200);
});

test("/api/home asks as every party too — the home has its own filter choice", async () => {
  // resolveViewer and /api/home decide this separately, so a test of one does not hold the other. The home
  // used to gate its cards on the party count, which is the same mistake in a second place.
  for (const rights of [[SUPER_READER], [SUPER_READER, OWN_PARTY]]) {
    const { bodies } = await askAs(rights, "/api/home", { asOf: INSTANT });
    const acs = bodies.find(
      (b): b is { filter: { filtersByParty: unknown; filtersForAnyParty?: unknown } } =>
        typeof b === "object" && b !== null && "filter" in b,
    );
    assert.ok(acs, "the home sent no active-contracts request");
    assert.ok(
      acs.filter.filtersForAnyParty !== undefined,
      "the home narrowed a viewer who reads as every party",
    );
  }
});

test("the visibility line on an update detail names the right circumstance", async () => {
  // buildUpdateDetail folds the per-event answers, and the fold used to rebuild no_party_found from the
  // count alone — so the new status never reached this screen even after explainVisibility learned it.
  const { buildUpdateDetail } = await import("@canton-lens/core");
  const update = {
    updateId: UPDATE_ID,
    offset: 5,
    effectiveAt: INSTANT,
    recordTime: INSTANT,
    events: [
      {
        CreatedEvent: {
          nodeId: 0,
          contractId: "00ab",
          templateId: HOLDING_INTERFACE,
          signatories: ["alice::1220ab"],
          observers: [],
          witnessParties: [],
          createArgument: {},
        },
      },
    ],
  };
  const superReader = buildUpdateDetail({ update: { Transaction: { value: update } } }, []);
  assert.ok(superReader.ok);
  assert.equal(superReader.view.kind, "transaction");
  assert.equal(
    superReader.view.visibility.status,
    "no_own_parties",
    "a viewer holding no party of their own was told a search had failed",
  );
  // A viewer who does hold a party, and is not on it, still gets the status that says so.
  const elsewhere = buildUpdateDetail({ update: { Transaction: { value: update } } }, [
    "carol::1220ab",
  ]);
  assert.ok(elsewhere.ok);
  assert.equal(elsewhere.view.kind, "transaction");
  assert.equal(elsewhere.view.visibility.status, "no_party_found");
});

test("the request carries filtersForAnyParty, and names no party beside it", async () => {
  // Naming parties next to filtersForAnyParty would narrow the very thing it is for, and an empty
  // filtersByParty is what the node was measured to accept alongside it.
  const { bodies } = await askAs(SUPER_READER, "/api/contracts");
  const acs = bodies.find(
    (b): b is { filter: { filtersByParty: unknown; filtersForAnyParty: unknown } } =>
      typeof b === "object" && b !== null && "filter" in b,
  );
  assert.ok(acs, "no active-contracts request was sent");
  assert.deepEqual(acs.filter.filtersForAnyParty, {
    cumulative: [
      { identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } },
    ],
  });
  assert.deepEqual(acs.filter.filtersByParty, {});
});

test("ParticipantAdmin is not a right to read — it is answered no_party_rights", async () => {
  // Measured on Canton 3.5.15: a user holding ParticipantAdmin and no CanReadAsAnyParty is answered 403
  // for a request carrying filtersForAnyParty. Counting it as instance-wide gave an administrator a badge
  // saying they could read the whole instance and a screen that could show them nothing.
  for (const [path, query] of PARTY_SCOPED) {
    const { response } = await askAs(PARTICIPANT_ADMIN, path, query);
    assert.equal(response.status, 403, path);
    assert.deepEqual(response.body, { reason: "no_party_rights" }, path);
  }
});

test("the three viewers are told apart — a super reader's answer is not the rightless one's", async () => {
  // The defect this fixes, stated as the test that would have caught it: all three used to be identical.
  const superReader = await askAs(SUPER_READER, "/api/contracts");
  const admin = await askAs(PARTICIPANT_ADMIN, "/api/contracts");
  const rightless = await ask("/api/contracts");
  assert.notDeepEqual(superReader.response, admin.response);
  assert.notDeepEqual(superReader.response, rightless.response);
  // These two genuinely cannot read, and answering them alike is correct.
  assert.deepEqual(admin.response, rightless.response);
});

test("/api/home never reports instance-wide scope and no_party_rights at once", async () => {
  const { response } = await askAs(SUPER_READER, "/api/home", { asOf: INSTANT });
  assert.equal(response.status, 200);
  const body = response.body as {
    viewer: { scope: string; partyCount: number };
    cards: { status: string; tokens?: { status: string; reason?: string } };
  };
  assert.equal(body.viewer.scope, "instance-wide");
  assert.equal(body.viewer.partyCount, 0);
  assert.notEqual(
    body.cards.status,
    "no_party_rights",
    "the viewer block and the cards contradicted each other",
  );
  // The cards that ask “mine” have no answer for this viewer, and say which circumstance that is rather
  // than reporting a zero.
  assert.equal(body.cards.tokens?.status, "unavailable");
  assert.equal(body.cards.tokens?.reason, "no_own_parties");
});
