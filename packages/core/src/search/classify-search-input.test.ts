import assert from "node:assert/strict";
import { test } from "node:test";
import { classifySearchInput } from "./classify-search-input.ts";

// **This search box is not full-text search.** It works out what the pasted text is and opens that one thing
// (there is no full-text search — the response's fullText is not_available).
// So "how does it recognize things" is all this function does, and the values below are real ones taken from a
// real node.
const CONTRACT_ID =
  "00ecde3ea7af1bd4e1db615f2aaf22b8dd461d3f052cc98d90b69894cd5e66bc54ca12122060a1d3b3cd4544476b158a0677f588f8bba7112003c68fbc2b6e13290bf4279b";
const UPDATE_ID = "122028a2958d52b74eef8e0361801be0af6236cc3467020e988a7de59e01687489ac";
const PACKAGE_ID = "a67e11be754b9b418b6bd7bbb66b956fce1bba287334296a82f69750d09de318";
const PARTY = "bob::12206876227d36dd5a8dd826830139844aa54b4b5fcdf4b5c5ddcacbab8a7b4eb457";

test("the four real id kinds are separated by length — 138·68·64 hex, and a party", () => {
  assert.equal(CONTRACT_ID.length, 138);
  assert.equal(UPDATE_ID.length, 68);
  assert.equal(PACKAGE_ID.length, 64);
  assert.deepEqual(classifySearchInput(CONTRACT_ID), {
    kind: "contract_id",
    contractId: CONTRACT_ID,
  });
  assert.deepEqual(classifySearchInput(UPDATE_ID), { kind: "update_id", updateId: UPDATE_ID });
  assert.deepEqual(classifySearchInput(PACKAGE_ID), { kind: "package_id", packageId: PACKAGE_ID });
  assert.deepEqual(classifySearchInput(PARTY), { kind: "party", party: PARTY });
});

test("one character off in length and it is not an id — the price of separating by length", () => {
  for (const n of [63, 65, 67, 69, 137, 139]) {
    const r = classifySearchInput("a".repeat(n));
    assert.equal(r.kind, "unrecognized", `${n} characters is none of the id kinds`);
  }
});

test("not hex is not an id even at the right length", () => {
  assert.equal(classifySearchInput("z".repeat(64)).kind, "unrecognized");
  // Uppercase hex is accepted (the regex has the i flag) — this is a place people paste into.
  assert.equal(classifySearchInput(PACKAGE_ID.toUpperCase()).kind, "package_id");
});

test("a leading # settles it as an interface — that notation is not used for templates", () => {
  const r = classifySearchInput("#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding");
  assert.deepEqual(r, {
    kind: "interface_id_confirmed",
    package_name: "splice-api-token-holding-v1",
    module_name: "Splice.Api.Token.HoldingV1",
    entity_name: "Holding",
  });
  assert.equal(
    r.kind === "interface_id_confirmed" && r.package_name.startsWith("#"),
    false,
    "the # is stripped before storing",
  );
});

test("a leading # without three segments is malformed_interface_tag — not absorbed into another branch", () => {
  for (const bad of ["#", "#a", "#a:b", "#a:b:c:d"]) {
    assert.deepEqual(classifySearchInput(bad), {
      kind: "unrecognized",
      reason: "malformed_interface_tag",
    });
  }
});

test("hash:module:entity cannot say whether it is a template or an interface — the shape is identical", () => {
  const r = classifySearchInput(`${PACKAGE_ID}:Explorer:Holding`);
  assert.deepEqual(r, {
    kind: "template_or_interface_fqn",
    package_name: PACKAGE_ID,
    module_name: "Explorer",
    entity_name: "Holding",
  });
});

test("an empty string is empty — a different name from unrecognized", () => {
  assert.deepEqual(classifySearchInput(""), { kind: "empty" });
});

test("a party shape is exactly one `::` with neither side empty", () => {
  assert.equal(classifySearchInput("a::b").kind, "party");
  assert.equal(classifySearchInput("a::b::c").kind, "unrecognized", "two `::` is not a party");
  assert.equal(classifySearchInput("::b").kind, "unrecognized", "the left side is empty");
  assert.equal(classifySearchInput("a::").kind, "unrecognized", "the right side is empty");
  assert.equal(
    classifySearchInput("a:b").kind,
    "unrecognized",
    "a single colon is neither a party nor an fqn",
  );
});

test("nothing a person would type matches anything — because there is no full-text search", () => {
  for (const word of ["alice", "Holding", "any words at all", "0073d5ae3bafdf"]) {
    assert.deepEqual(classifySearchInput(word), {
      kind: "unrecognized",
      reason: "no_shape_matched",
    });
  }
});
