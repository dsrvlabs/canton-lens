import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTemplateFqn } from "./parse-template-identifier.ts";

// The inputs are real ones taken from a real node. This replaces the old test that read a fixture
// file — the values are of the same kind, and now that they are written here rather than in a file, what is
// being tested is visible.
const REAL = "a67e11be754b9b418b6bd7bbb66b956fce1bba287334296a82f69750d09de318:Explorer:Holding";

test("a real templateId splits into three segments — the first is the packageId hash", () => {
  const r = parseTemplateFqn(REAL);
  assert.ok(r.ok);
  assert.equal(
    r.package_name.length,
    64,
    "the first segment at tier 1 is 64 sha256 hex characters",
  );
  assert.equal(r.module_name, "Explorer");
  assert.equal(r.entity_name, "Holding");
});

test("a module name with dots is still one segment — only colons separate segments", () => {
  const r = parseTemplateFqn("#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding");
  assert.ok(r.ok);
  assert.equal(r.package_name, "#splice-api-token-holding-v1");
  assert.equal(r.module_name, "Splice.Api.Token.HoldingV1");
});

test("an empty string is empty_string — a different name from a segment-count problem", () => {
  assert.deepEqual(parseTemplateFqn(""), { ok: false, reason: "empty_string" });
});

test("not three segments is malformed_arity", () => {
  for (const bad of ["a", "a:b", "a:b:c:d", "a:b:c:d:e"]) {
    assert.deepEqual(
      parseTemplateFqn(bad),
      { ok: false, reason: "malformed_arity" },
      `"${bad}" is not three segments`,
    );
  }
});

test("the right count with one empty is empty_segment — said separately from arity", () => {
  for (const bad of ["::", ":b:c", "a::c", "a:b:"]) {
    assert.deepEqual(
      parseTemplateFqn(bad),
      { ok: false, reason: "empty_segment" },
      `"${bad}" has an empty segment`,
    );
  }
});

test("whitespace is not trimmed — the text becomes the segment verbatim", () => {
  // This layer does not tidy its input. Tidying is the caller's job, and quietly correcting it here would
  // make "what was asked" differ from layer to layer.
  const r = parseTemplateFqn(" a : b : c ");
  assert.ok(r.ok);
  assert.equal(r.package_name, " a ");
  assert.equal(r.module_name, " b ");
});
