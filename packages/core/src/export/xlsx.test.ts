import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { RecentUpdateRow } from "../recent-updates/build-recent-updates.ts";
import {
  buildTransactionsSheetRows,
  TRANSACTIONS_COLUMNS,
  transactionsFileName,
} from "./transactions-sheet.ts";
import { buildXlsx, cellRef, sheetName } from "./xlsx.ts";

const AT = new Date("2026-09-16T04:52:05.903Z");

const update = (over: Partial<RecentUpdateRow> = {}): RecentUpdateRow => ({
  updateId: "u-1",
  offset: 150,
  effectiveAt: "2026-09-14T11:12:43.402229Z",
  submittedByYou: false,
  events: [
    {
      kind: "created",
      contractId: "00cbb916",
      package: "a67e11be",
      module: "Explorer",
      entity: "Holding",
      parties: ["bob::1220ab"],
      witnessParties: ["alice::1220cd", "bob::1220ab"],
    },
  ],
  ...over,
});

test("an update's fields repeat down its events, so every line stands on its own", () => {
  const rows = buildTransactionsSheetRows([
    update({
      events: [
        { ...update().events[0]!, kind: "archived", contractId: "00aaa" },
        { ...update().events[0]!, kind: "created", contractId: "00bbb" },
      ],
    }),
  ]);
  assert.deepEqual(rows[0], [...TRANSACTIONS_COLUMNS]);
  assert.equal(rows.length, 3, "one header and one line per event");
  assert.equal(rows[1]?.[0], "150");
  assert.equal(rows[2]?.[0], "150", "the offset repeats rather than being left blank");
  assert.equal(rows[1]?.[5], "00aaa");
  assert.equal(rows[2]?.[5], "00bbb");
});

test("an update with no visible event still gets a line", () => {
  // Dropping it would make the export disagree with the count the screen just showed.
  const rows = buildTransactionsSheetRows([update({ events: [] })]);
  assert.equal(rows.length, 2);
  assert.equal(rows[1]?.[1], "u-1");
  assert.equal(rows[1]?.slice(4).join(""), "", "the event columns are empty, not absent");
  assert.equal(rows[1]?.length, TRANSACTIONS_COLUMNS.length, "the line is still full width");
});

test("several parties share a cell with a separator that survives re-import", () => {
  const rows = buildTransactionsSheetRows([update()]);
  assert.equal(rows[1]?.[10], "alice::1220cd; bob::1220ab");
});

test("column references count base-26 without a zero", () => {
  assert.equal(cellRef(0, 0), "A1");
  assert.equal(cellRef(25, 0), "Z1");
  // The case a plain radix conversion gets wrong: 26 is AA, not BA.
  assert.equal(cellRef(26, 1), "AA2");
  assert.equal(cellRef(27, 1), "AB2");
  assert.equal(cellRef(51, 0), "AZ1");
  assert.equal(cellRef(52, 0), "BA1");
});

test("a sheet name Excel would refuse is made acceptable rather than handed on", () => {
  assert.equal(sheetName("a/b:c?d*e[f]g"), "a b c d e f g");
  assert.equal(sheetName(""), "Sheet1");
  assert.equal(sheetName("x".repeat(40)).length, 31);
});

test("the file name carries the instant, and no colon a filesystem would refuse", () => {
  const name = transactionsFileName(AT);
  assert.equal(name, "canton-lens-transactions-2026-09-16T04-52-05Z.xlsx");
  assert.ok(!name.includes(":"));
});

test("every value is written as a string, so Excel cannot re-read an id as a number", () => {
  const bytes = buildXlsx(
    { name: "Transactions", rows: [["Offset"], ["00123456789012345678"]] },
    AT,
  );
  const text = Buffer.from(bytes).toString("latin1");
  assert.ok(text.includes('t="inlineStr"'), "cells are typed as strings");
  assert.ok(
    text.includes("00123456789012345678"),
    "the digits survive; as a number this would become 1.23457E+17 and lose its leading zeros",
  );
});

test("the archive is one a zip reader accepts, with the five parts Excel needs", () => {
  const rows = buildTransactionsSheetRows([update()]);
  const bytes = buildXlsx({ name: "Transactions", rows }, AT);
  const dir = mkdtempSync(join(tmpdir(), "xlsx-"));
  const file = join(dir, "out.xlsx");
  writeFileSync(file, bytes);
  // **Checked by a reader that is not this code.** A self-consistent archive proves nothing about
  // whether Excel opens it; unzip agreeing that the CRCs and the central directory are right is the
  // closest a unit test gets to that.
  const listed = execFileSync("unzip", ["-l", file], { encoding: "utf8" });
  for (const part of [
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "xl/worksheets/sheet1.xml",
  ]) {
    assert.ok(listed.includes(part), `${part} is in the archive`);
  }
  execFileSync("unzip", ["-t", file]);

  const sheet = execFileSync("unzip", ["-p", file, "xl/worksheets/sheet1.xml"], {
    encoding: "utf8",
  });
  assert.ok(sheet.includes('<t xml:space="preserve">Offset</t>'));
  assert.ok(sheet.includes("00cbb916"));
});

test("a value carrying XML syntax is escaped rather than breaking the sheet", () => {
  const bytes = buildXlsx({ name: "S", rows: [["a & b <c>"]] }, AT);
  const text = Buffer.from(bytes).toString("utf8");
  assert.ok(text.includes("a &amp; b &lt;c&gt;"));
});
