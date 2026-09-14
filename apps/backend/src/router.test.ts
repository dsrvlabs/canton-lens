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
