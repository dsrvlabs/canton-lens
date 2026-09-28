import assert from "node:assert/strict";
import test from "node:test";
import type { ContractListRow } from "../contract-list/build-contract-list.ts";
import type { RecentUpdateRow } from "../recent-updates/build-recent-updates.ts";
import { buildLifelines, groupLifelines } from "./build-lifelines.ts";

const WINDOW = { from: 100, to: 150 };

const event = (
  kind: "created" | "archived",
  contractId: string,
  entity = "Holding",
  parties: string[] = ["alice::1", "bob::2"],
) => ({
  kind,
  contractId,
  package: "pkg",
  module: "Explorer",
  entity,
  // created means signatories ∪ observers; for archived the ledger does not give them.
  parties: kind === "created" ? parties : [],
  witnessParties: [],
});

const update = (offset: number, events: ReturnType<typeof event>[]): RecentUpdateRow => ({
  updateId: `u${offset}`,
  offset,
  effectiveAt: "2026-09-09T10:00:00Z",
  events,
  submittedByYou: false,
});

const acs = (contractId: string, offset: number | null, entity = "Holding"): ContractListRow => ({
  contractId,
  package: "pkg",
  packageName: "explorer-testdata",
  module: "Explorer",
  entity,
  counterpartyParty: [],
  myRoles: [],
  createdAt: "2026-09-09T10:00:00Z",
  offset,
});

const byId = (lines: ReturnType<typeof buildLifelines>) =>
  new Map(lines.map((line) => [line.contractId, line]));

test("a contract created and archived inside the window has both ends known", () => {
  const lines = byId(
    buildLifelines(
      [update(140, [event("archived", "c1")]), update(120, [event("created", "c1")])],
      [],
      WINDOW,
    ),
  );
  const c1 = lines.get("c1");
  assert.ok(c1);
  assert.deepEqual(
    { start: c1.start, startKnown: c1.startKnown, end: c1.end, endKnown: c1.endKnown },
    { start: 120, startKnown: true, end: 140, endKnown: true },
  );
  assert.equal(c1.state, "archived");
  assert.equal(c1.archivedBy, "u140");
  // **Its stakeholders survive the archive.** The rows arrive newest first, so the archive is read before
  // the creation — and an archive carries no signatories or observers. Keeping whichever event was seen
  // first left every contract that ended inside the window with no parties at all, while its creation sat
  // in the same window carrying them.
  assert.deepEqual(c1.parties, ["alice::1", "bob::2"]);
});

test("a contract created inside the window and still active runs to the window's end", () => {
  const lines = byId(
    buildLifelines([update(130, [event("created", "c2")])], [acs("c2", 130)], WINDOW),
  );
  const c2 = lines.get("c2");
  assert.ok(c2);
  assert.equal(c2.state, "alive");
  assert.equal(c2.start, 130);
  assert.equal(c2.startKnown, true);
  assert.equal(c2.end, WINDOW.to);
  assert.equal(c2.endKnown, false);
  assert.equal(c2.archivedBy, null);
});

test("a contract older than the window is drawn from the edge, and says the edge is not its birth", () => {
  // No event in the window at all — the bar exists only because the ACS says the contract is alive.
  const lines = byId(buildLifelines([], [acs("c3", 40)], WINDOW));
  const c3 = lines.get("c3");
  assert.ok(c3);
  assert.equal(c3.start, WINDOW.from);
  assert.equal(c3.startKnown, false);
  assert.equal(c3.state, "alive");
});

test("an archive with no create in the window keeps the known end and an unknown start", () => {
  const lines = byId(buildLifelines([update(120, [event("archived", "c9")])], [], WINDOW));
  const c9 = lines.get("c9");
  assert.ok(c9);
  assert.equal(c9.start, WINDOW.from);
  assert.equal(c9.startKnown, false);
  assert.equal(c9.end, 120);
  assert.equal(c9.endKnown, true);
  assert.equal(c9.state, "archived");
});

test("with no ACS row, the created event's parties are the answer", () => {
  const lines = byId(buildLifelines([update(130, [event("created", "c10")])], [], WINDOW));
  assert.deepEqual(lines.get("c10")?.parties, ["alice::1", "bob::2"]);
});

test("no archive seen and not in the active contracts is unknown, never alive", () => {
  // The end can go missing: an archived event carries no signatories or observers, so a filtered window
  // can lose it. Drawing that as "alive" would be a guess.
  const lines = byId(buildLifelines([update(130, [event("created", "c4")])], [], WINDOW));
  const c4 = lines.get("c4");
  assert.ok(c4);
  assert.equal(c4.state, "unknown");
  assert.equal(c4.endKnown, false);
  assert.equal(c4.end, WINDOW.to);
});

test("the ACS row wins over the event for the template name and the creation offset", () => {
  const lines = byId(
    buildLifelines([update(130, [event("created", "c5")])], [acs("c5", 130)], WINDOW),
  );
  const c5 = lines.get("c5");
  assert.ok(c5);
  assert.equal(c5.packageName, "explorer-testdata");
});

test("an ACS row without a creation offset does not pretend to know the start", () => {
  const lines = byId(buildLifelines([], [acs("c6", null)], WINDOW));
  const c6 = lines.get("c6");
  assert.ok(c6);
  assert.equal(c6.startKnown, false);
  assert.equal(c6.start, WINDOW.from);
});

test("the earliest event wins if the same contract appears twice", () => {
  const lines = byId(
    buildLifelines(
      [update(140, [event("created", "c7")]), update(110, [event("created", "c7")])],
      [],
      WINDOW,
    ),
  );
  assert.equal(lines.get("c7")?.start, 110);
});

test("the parties come from the ACS row when it exists, mine first", () => {
  const row = acs("c8", 130);
  const withRoles: ContractListRow = {
    ...row,
    myRoles: [{ party: "alice::1", roles: ["signatory"] }],
    counterpartyParty: ["bob::2", "carol::3"],
  };
  const lines = byId(buildLifelines([update(130, [event("created", "c8")])], [withRoles], WINDOW));
  assert.deepEqual(lines.get("c8")?.parties, ["alice::1", "bob::2", "carol::3"]);
});

test("an archive-only lifetime claims no parties — a witness is not a stakeholder", () => {
  // The ledger gives no signatories or observers on an archived event, so inventing an owner there
  // would be a guess. Empty says "not known from what arrived".
  const lines = byId(buildLifelines([update(120, [event("archived", "c9")])], [], WINDOW));
  assert.deepEqual(lines.get("c9")?.parties, []);
});

test("groups are biggest first, and inside a group the earliest start is first", () => {
  const lines = buildLifelines(
    [
      update(130, [event("created", "c2", "Membership")]),
      update(120, [event("created", "c1")]),
      update(110, [event("created", "c0")]),
    ],
    [],
    WINDOW,
  );
  const groups = groupLifelines(lines);
  assert.deepEqual(
    groups.map((g) => [g.key, g.lines.length]),
    [
      ["Explorer:Holding", 2],
      ["Explorer:Membership", 1],
    ],
  );
  assert.deepEqual(
    groups[0]?.lines.map((l) => l.contractId),
    ["c0", "c1"],
  );
});
