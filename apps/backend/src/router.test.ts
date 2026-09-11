import assert from "node:assert/strict";
import { test } from "node:test";
import { _isInstantString } from "./router.ts";

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
