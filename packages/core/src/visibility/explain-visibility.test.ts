import assert from "node:assert/strict";
import { test } from "node:test";
import { explainVisibility } from "./explain-visibility.ts";

// “Why I can see this”. The material is only what has already arrived — no new query.
// The party values are real ones from a real node. Names are shortened but the shape matches
// the real thing (name::1220+hex64).
const ALICE = "alice::1220a4cae93312d1211927caf3c30e5865ed5310f4d2860a00a062f77bc4dca14927";
const BOB = "bob::1220a4cae93312d1211927caf3c30e5865ed5310f4d2860a00a062f77bc4dca14927";
const CAROL = "carol::1220a4cae93312d1211927caf3c30e5865ed5310f4d2860a00a062f77bc4dca14927";

test("a signatory is signatory, an observer is observer — the role is named as it is", () => {
  // The seed's Holding: signatory = issuer, observer = owner.
  const r = explainVisibility([ALICE, BOB], { signatories: [ALICE], observers: [BOB] });
  assert.deepEqual(r, {
    status: "ok",
    reasons: [
      { party: ALICE, roles: ["signatory"] },
      { party: BOB, roles: ["observer"] },
    ],
  });
});

test("both roles are recorded when both apply — they are not flattened into one", () => {
  const r = explainVisibility([ALICE], { signatories: [ALICE], observers: [ALICE] });
  assert.deepEqual(r, {
    status: "ok",
    reasons: [{ party: ALICE, roles: ["signatory", "observer"] }],
  });
});

test("in witnessParties but not a stakeholder is witness — the third role", () => {
  const r = explainVisibility([CAROL], {
    signatories: [ALICE],
    observers: [BOB],
    witnessParties: [CAROL],
  });
  assert.deepEqual(r, { status: "ok", reasons: [{ party: CAROL, roles: ["witness"] }] });
});

test("a stakeholder does not also get witness for appearing in witnessParties", () => {
  // witness means “neither of those two, yet witnessed it”. With a role already, that statement is not needed.
  const r = explainVisibility([ALICE], {
    signatories: [ALICE],
    observers: [],
    witnessParties: [ALICE],
  });
  assert.deepEqual(r, { status: "ok", reasons: [{ party: ALICE, roles: ["signatory"] }] });
});

test("without witnessParties there are only two roles — the two-tier design of the ACS path (contract list and detail)", () => {
  // Only stakeholders arrive over the ACS, so the caller does not pass witnessParties.
  // In that case witness must be impossible.
  const r = explainVisibility([CAROL], { signatories: [ALICE], observers: [BOB] });
  assert.deepEqual(r, { status: "no_party_found" });
});

test("none of my parties anywhere is no_party_found — not “not visible”", () => {
  // If this contract reached me, the material is incomplete — say so rather than invent an answer.
  const r = explainVisibility([CAROL], {
    signatories: [ALICE],
    observers: [BOB],
    witnessParties: [ALICE, BOB],
  });
  assert.deepEqual(r, { status: "no_party_found" });
});

test("a stakeholder field that is not an array of strings is unavailable — not flattened to 0 or “not visible”", () => {
  assert.deepEqual(explainVisibility([ALICE], { signatories: undefined, observers: [] }), {
    status: "unavailable",
    reason: "stakeholders_not_string_arrays",
  });
  assert.deepEqual(explainVisibility([ALICE], { signatories: [ALICE], observers: "nope" }), {
    status: "unavailable",
    reason: "stakeholders_not_string_arrays",
  });
  assert.deepEqual(explainVisibility([ALICE], { signatories: [1, 2], observers: [] }), {
    status: "unavailable",
    reason: "stakeholders_not_string_arrays",
  });
});

test("witnessParties present but not an array is unavailable under its own name", () => {
  assert.deepEqual(
    explainVisibility([ALICE], { signatories: [], observers: [], witnessParties: "nope" }),
    { status: "unavailable", reason: "witness_parties_not_string_array" },
  );
});

test("answers in viewer-party order", () => {
  const r = explainVisibility([BOB, ALICE], { signatories: [ALICE], observers: [BOB] });
  assert.ok(r.status === "ok");
  assert.deepEqual(
    r.reasons.map((x) => x.party),
    [BOB, ALICE],
  );
});

test("no viewer parties of my own is its own status — not a search that failed", () => {
  // The viewer that reaches here with an empty list is the super reader (CanReadAsAnyParty): they read as
  // every party and hold none. no_party_found would say a match was looked for and not found, which the
  // screen words as “the material is lacking” — about material that is complete.
  assert.deepEqual(explainVisibility([], { signatories: [ALICE], observers: [BOB] }), {
    status: "no_own_parties",
  });
  // The distinction is kept: a viewer who does hold a party, and does not appear, still gets no_party_found.
  assert.deepEqual(explainVisibility([CAROL], { signatories: [ALICE], observers: [BOB] }), {
    status: "no_party_found",
  });
});

// ── controller — the capacity an exercised event brings ───────────────────────

test("an acting party is controller, not a witness — exercising is not seeing from above", () => {
  // An exercised event carries no stakeholders of its own; before the capacity existed, the party that
  // exercised the choice was reported as a witness, which says the opposite of what it did.
  const r = explainVisibility([ALICE], {
    signatories: [],
    observers: [],
    witnessParties: [ALICE, BOB],
    actingParties: [ALICE],
  });
  assert.deepEqual(r, { status: "ok", reasons: [{ party: ALICE, roles: ["controller"] }] });
});

test("a stakeholder who also acted is both — the capacities are counted separately", () => {
  const r = explainVisibility([ALICE], {
    signatories: [ALICE],
    observers: [],
    witnessParties: [ALICE],
    actingParties: [ALICE],
  });
  assert.deepEqual(r, {
    status: "ok",
    reasons: [{ party: ALICE, roles: ["signatory", "controller"] }],
  });
});

test("witness still means neither of the three — the fallback did not widen", () => {
  const r = explainVisibility([BOB], {
    signatories: [ALICE],
    observers: [],
    witnessParties: [BOB],
    actingParties: [ALICE],
  });
  assert.deepEqual(r, { status: "ok", reasons: [{ party: BOB, roles: ["witness"] }] });
});

test("acting parties that are not a string array are a lacking material, not an empty answer", () => {
  const r = explainVisibility([ALICE], {
    signatories: [ALICE],
    observers: [],
    actingParties: "alice",
  });
  assert.deepEqual(r, { status: "unavailable", reason: "acting_parties_not_string_array" });
});
