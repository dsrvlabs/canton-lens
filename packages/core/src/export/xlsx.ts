// A spreadsheet of one sheet, written as the smallest `.xlsx` Excel will open.
//
// **Why a workbook rather than CSV.** Every column this product exports is an identifier — contract
// ids, update ids, offsets, party ids. CSV carries no types, so Excel guesses, and its guesses on
// this data are wrong in ways that are hard to notice: a long run of digits becomes `1.23457E+18`,
// and a value with leading zeros loses them. Once saved, the original is gone. A workbook states the
// type per cell, so every value below goes in as a string and comes back out as what was exported.
//
// The parts are the four an `.xlsx` cannot do without, plus the sheet. No styles, no shared strings
// (strings are inline), no calc chain — a reader can check this against the OOXML specification
// without following indirections.

import { type ZipEntry, zip } from "./zip.ts";

export type Sheet = {
  name: string;
  // The first row is the header. Every cell is written as a string; see the note above.
  rows: readonly (readonly string[])[];
};

// XML text escaping. `"` and `'` are left alone deliberately — the values only ever land in element
// content here, never in an attribute, and escaping them there would put `&quot;` in the cell.
const xml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A1, B1 … Z1, AA1. Column indexes are base-26 **without a zero**, so this is not a plain radix
// conversion: the remainder is taken before the division, not after.
export function cellRef(column: number, row: number): string {
  let name = "";
  let n = column;
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  }
  return `${name}${row + 1}`;
}

// Excel refuses a sheet name carrying any of : \ / ? * [ ], or one longer than 31 characters, and it
// refuses the whole file rather than the name. Rather than hand that failure to whoever opens it,
// the name is made acceptable here.
const INVALID_IN_SHEET_NAME = /[:\\/?*[\]]/g;
export function sheetName(name: string): string {
  const cleaned = name.replace(INVALID_IN_SHEET_NAME, " ").trim();
  return (cleaned === "" ? "Sheet1" : cleaned).slice(0, 31);
}

function sheetXml(rows: Sheet["rows"]): string {
  const body = rows
    .map((cells, r) => {
      const cs = cells
        .map(
          (value, c) =>
            `<c r="${cellRef(c, r)}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`,
        )
        .join("");
      return `<row r="${r + 1}">${cs}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

const workbookXml = (name: string): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

export function buildXlsx(sheet: Sheet, at: Date): Uint8Array {
  const encoder = new TextEncoder();
  const name = sheetName(sheet.name);
  const entries: ZipEntry[] = [
    { path: "[Content_Types].xml", bytes: encoder.encode(CONTENT_TYPES) },
    { path: "_rels/.rels", bytes: encoder.encode(ROOT_RELS) },
    { path: "xl/workbook.xml", bytes: encoder.encode(workbookXml(name)) },
    { path: "xl/_rels/workbook.xml.rels", bytes: encoder.encode(WORKBOOK_RELS) },
    { path: "xl/worksheets/sheet1.xml", bytes: encoder.encode(sheetXml(sheet.rows)) },
  ];
  return zip(entries, at);
}
