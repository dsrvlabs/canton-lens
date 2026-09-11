// The search preview's two judgments — turning a response into rows (hitsOf · unavailableOf) and sifting out
// what is not worth asking about (worthAsking).
// Drawing and wiring (debounce, focus, keyboard) are not covered here: breakage there shows the moment it is
// used, while these two rot quietly.
import assert from "node:assert/strict";
import { test } from "node:test";
import { hitsOf, unavailableOf, worthAsking } from "../src/search/preview-hits.ts";

const NONE = { status: "not_applicable" };
const results = (over) => ({
  results: {
    q: "",
    kind: "unrecognized",
    updates: NONE,
    contracts: NONE,
    parties: NONE,
    templates: NONE,
    packages: NONE,
    fullText: "not_available",
    ...over,
  },
});

test("an update row writes the kind the server stated, as is", () => {
  const [hit] = hitsOf(
    results({
      updates: {
        status: "ok",
        rows: [{ updateId: "1220ab", offset: 42, effectiveAt: null, kind: "reassignment" }],
      },
    }),
  );
  assert.equal(hit.group, "Updates");
  assert.equal(hit.label, "1220ab");
  // Writing "Transaction" on all of them would say something the response never said.
  assert.equal(hit.detail, "Offset 42 · reassignment");
  assert.equal(hit.to, "#/tx/1220ab");
});

test("an update with no offset leaves the slot blank", () => {
  const [hit] = hitsOf(
    results({
      updates: {
        status: "ok",
        rows: [{ updateId: "1220cd", offset: null, effectiveAt: null, kind: "transaction" }],
      },
    }),
  );
  assert.equal(hit.detail, "Offset – · transaction");
});

test("contracts, parties and packages each go to their own place", () => {
  const hits = hitsOf(
    results({
      contracts: { status: "ok", rows: [{ contractId: "00ab", entity: "Iou" }] },
      parties: { status: "ok", rows: [{ party: "alice::1220ef", contractCount: 3 }] },
      packages: { status: "ok", rows: [{ packageId: "aa11", name: null, inMyContracts: true }] },
    }),
  );
  assert.deepEqual(
    hits.map((hit) => [hit.group, hit.label, hit.detail, hit.to]),
    [
      ["Contracts", "00ab", "Iou", "#/contract/00ab"],
      ["Parties", "alice::1220ef", "3 shared contracts", "#/party/alice%3A%3A1220ef"],
      // A package has no screen of its own — it searches again by that id. With no name, the id stands
      // in the name's place.
      ["Packages", "aa11", "aa11", "#/search?q=aa11"],
    ],
  );
});

test("two templates going to the same place fold into one row", () => {
  // The catalog distinguishes by the whole templateId, but the preview's destination is only
  // module:entity — the same template differing only in package version becomes two indistinguishable rows
  // (their React keys match too).
  const hits = hitsOf(
    results({
      templates: {
        status: "ok",
        rows: [
          { templateId: "p1:Iou:Iou", packageId: "p1", packageName: "iou", module: "Iou", entity: "Iou", contractCount: 1 },
          { templateId: "p2:Iou:Iou", packageId: "p2", packageName: "iou", module: "Iou", entity: "Iou", contractCount: 2 },
        ],
      },
    }),
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].to, "#/contracts?template=Iou%3AIou");
});

test("templates with different names do not fold", () => {
  const hits = hitsOf(
    results({
      templates: {
        status: "ok",
        rows: [
          { templateId: "p1:Iou:Iou", packageId: "p1", packageName: "iou", module: "Iou", entity: "Iou", contractCount: 1 },
          { templateId: "p1:Iou:Transfer", packageId: "p1", packageName: "iou", module: "Iou", entity: "Transfer", contractCount: 1 },
        ],
      },
    }),
  );
  assert.equal(hits.length, 2);
});

test("the panel is cut off at eight rows", () => {
  const hits = hitsOf(
    results({
      contracts: {
        status: "ok",
        rows: Array.from({ length: 12 }, (_, i) => ({ contractId: `00${i}`, entity: "Iou" })),
      },
    }),
  );
  assert.equal(hits.length, 8);
});

test("sections that did not answer or could not be fetched make no rows", () => {
  assert.deepEqual(hitsOf(results({ templates: { status: "unavailable", reason: "node_error" } })), []);
  assert.deepEqual(hitsOf(results({})), []);
});

test("a section that could not be fetched is told by name and reason", () => {
  const lines = unavailableOf(
    results({
      templates: { status: "unavailable", reason: "node_error" },
      packages: { status: "unavailable", reason: "some_new_reason" },
    }),
  );
  // A name in the dictionary is put in human words; one that is not is left exactly as the server said it —
  // neither gets lumped together.
  assert.deepEqual(lines, ["Templates — The node refused", "Packages — some_new_reason"]);
  assert.deepEqual(unavailableOf(results({})), []);
});

test("an id that is not fully typed is not asked about", () => {
  const hex = (n) => "a".repeat(n);
  // The three complete lengths (package 64 · update 68 · contract 138) are asked about.
  for (const n of [64, 68, 138]) assert.equal(worthAsking(hex(n)), true, `${n} chars`);
  // A fragment in between cannot find that id — instead an unrelated package caught by the prefix comes up.
  for (const n of [8, 20, 63, 65, 137]) assert.equal(worthAsking(hex(n)), false, `${n} chars`);
  // A short run of hex may be the start of a name.
  assert.equal(worthAsking("abcdef"), true);
  // Names and parties are not runs of hex.
  assert.equal(worthAsking("Iou"), true);
  assert.equal(worthAsking(`alice::1220${hex(64)}`), true);
  // Case is not distinguished.
  assert.equal(worthAsking("A".repeat(68)), true);
  assert.equal(worthAsking("A".repeat(20)), false);
});
