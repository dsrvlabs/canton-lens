import assert from "node:assert/strict";
import test from "node:test";
import { eventMatchesFilter } from "./filter-recent-updates.ts";

const event = {
  kind: "created" as const,
  contractId: "contract",
  package: "pkg",
  module: "Transfer",
  entity: "Offer",
  parties: ["alice::1", "bob::2"],
  witnessParties: ["alice::1"],
};

test("multi-party update filters match any selected party across stakeholders and witnesses", () => {
  assert.equal(eventMatchesFilter(event, { parties: ["carol::3", "bob::2"] }), true);
  assert.equal(eventMatchesFilter(event, { parties: ["carol::3", "dave::4"] }), false);
});
