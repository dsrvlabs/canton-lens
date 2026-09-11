import assert from "node:assert/strict";
import { test } from "node:test";
import { interfaceIdsMatch, isWellFormedInterfaceId } from "./interface-id-equivalence.ts";

test("name form vs hash form, same Module/Entity -> true", () => {
  assert.equal(
    interfaceIdsMatch(
      "#explorer-token-standard:ExplorerTokenStandard:TransferInstruction",
      "4b63c7f349969ae558615a73bc05f80c34943c82fdc17192c275730ceab5a75c:ExplorerTokenStandard:TransferInstruction",
    ),
    true,
  );
});

test("a different Module -> false", () => {
  assert.equal(
    interfaceIdsMatch(
      "#explorer-token-standard:OtherModule:TransferInstruction",
      "4b63c7f349969ae558615a73bc05f80c34943c82fdc17192c275730ceab5a75c:ExplorerTokenStandard:TransferInstruction",
    ),
    false,
  );
});

test("a different Entity -> false", () => {
  assert.equal(
    interfaceIdsMatch(
      "#explorer-token-standard:ExplorerTokenStandard:Other",
      "4b63c7f349969ae558615a73bc05f80c34943c82fdc17192c275730ceab5a75c:ExplorerTokenStandard:TransferInstruction",
    ),
    false,
  );
});

test("hash vs hash, different hashes -> false", () => {
  assert.equal(
    interfaceIdsMatch(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:ExplorerTokenStandard:TransferInstruction",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:ExplorerTokenStandard:TransferInstruction",
    ),
    false,
  );
});

test("hash vs hash, same hash -> true", () => {
  assert.equal(
    interfaceIdsMatch(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:ExplorerTokenStandard:TransferInstruction",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:ExplorerTokenStandard:TransferInstruction",
    ),
    true,
  );
});

test("a string with 2 colons (not 3 tokens) -> false", () => {
  assert.equal(interfaceIdsMatch("foo:bar", "foo:bar:baz"), false);
});

test("a string with 4 colons (5 tokens) -> false", () => {
  assert.equal(interfaceIdsMatch("a:b:c:d:e", "a:b:c:d:e"), false);
});

// ── isWellFormedInterfaceId — keeps “not an id” from reaching the ledger ────────────
// Uses the two notations taken from a real node as they are. Even after passing this, the ledger
// may answer “no such package” — existence is not judged here.

const NAME_FORM = "#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding";
const HASH_FORM =
  "718a0f77e505a8de0000000000000000000000000000000000000000000000ab:Splice.Api.Token.HoldingV1:Holding";

test("both real notations pass — the name form and the hash form", () => {
  assert.equal(isWellFormedInterfaceId(NAME_FORM), true);
  assert.equal(isWellFormedInterfaceId(HASH_FORM), true);
  // A module name with dots is normal (Splice.Api.Token.HoldingV1) — several names joined by dots.
  assert.equal(isWellFormedInterfaceId("#p:A.B.C:E"), true);
});

test("not three segments, not an id", () => {
  for (const bad of ["", "__main__", "a:b", "#pkg:Mod:Ent:extra", ":::"]) {
    assert.equal(isWellFormedInterfaceId(bad), false, `"${bad}" is not an id`);
  }
});

test("the package segment is only `#name` or 64 hex characters", () => {
  assert.equal(isWellFormedInterfaceId("0:A:A"), false, "0 is neither a name nor a hash");
  assert.equal(isWellFormedInterfaceId("abc:A:A"), false, "short hex is not a package id");
  assert.equal(isWellFormedInterfaceId(`${"a".repeat(63)}:A:A`), false, "63 characters");
  assert.equal(isWellFormedInterfaceId(`${"a".repeat(64)}:A:A`), true, "64 characters");
  assert.equal(isWellFormedInterfaceId(`${"a".repeat(65)}:A:A`), false, "65 characters");
  assert.equal(isWellFormedInterfaceId("#:A:A"), false, "nothing after the #");
});

test("a dot never appears in a package **name** — the ledger says so", () => {
  // The real error: "non expected character 0x2e in Daml-LF Package Name".
  // Counting the 34 package names on this node, none had a dot or an underscore; all were letters, digits and hyphens.
  assert.equal(isWellFormedInterfaceId("#a.b:M:E"), false);
  assert.equal(isWellFormedInterfaceId("#daml-prim-DA-Internal-Erased:M:E"), true);
});

test("a module or entity starts with a letter or an underscore — Daml's full name grammar is not implemented", () => {
  assert.equal(isWellFormedInterfaceId("#p:0Mod:E"), false, "starts with a digit");
  assert.equal(isWellFormedInterfaceId("#p:M:0Ent"), false);
  assert.equal(isWellFormedInterfaceId("#p:_M:_E"), true, "a leading underscore is a Daml name");
  assert.equal(isWellFormedInterfaceId("#p:M2:E2"), true, "a digit in the middle is fine");
  assert.equal(
    isWellFormedInterfaceId("#p:A..B:E"),
    false,
    "two dots, which create an empty segment",
  );
});

test("judging the shape and judging equivalence are different questions", () => {
  // Two malformed ids can come back as “the same” — interfaceIdsMatch does not look at the shape.
  assert.equal(
    interfaceIdsMatch("#0:A:A", "#1:A:A"),
    true,
    "between two name forms, only module/entity are compared",
  );
  assert.equal(
    isWellFormedInterfaceId("#0:A:A"),
    true,
    "this one is well-formed even with `0` as the name",
  );
  assert.equal(
    isWellFormedInterfaceId("0:A:A"),
    false,
    "this one has no #, so it reads as a hash, and then it is wrong",
  );
});
