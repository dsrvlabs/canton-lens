import assert from "node:assert/strict";
import test from "node:test";
import { contractMatchesFilter } from "./build-contract-list.ts";

const contract = {
  package: "pkg",
  module: "Transfer",
  entity: "Offer",
  parties: ["alice::1", "bob::2"],
};

test("multi-party contract filters match any selected party", () => {
  assert.equal(contractMatchesFilter(contract, { parties: ["carol::3", "bob::2"] }), true);
  assert.equal(contractMatchesFilter(contract, { parties: ["carol::3", "dave::4"] }), false);
});
