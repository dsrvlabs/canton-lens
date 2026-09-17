import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUpdateDetail } from "./build-update-detail.ts";

// Divulgence, read off one point lookup. The shape is the recorded one: an Accept whose body creates a
// Holding, seen by a reader who is an informee of the root and therefore of everything under it.
const SUF = "1220e2b3c32f91feb4a21be4ea30a8302f1e9825e8ee2c9b3dd1bac4b84730372db9";
const ALICE = `alice::${SUF}`;
const BOB = `bob::${SUF}`;
const PKG = "a67e11be754b9b418b6bd7bbb66b956fce1bba287334296a82f69750d09de318";

const created = (overrides: Record<string, unknown>) => ({
  CreatedEvent: {
    offset: 150,
    nodeId: 1,
    contractId: "00cbb916",
    templateId: `${PKG}:Explorer:Holding`,
    createArgument: {},
    signatories: [BOB],
    observers: [],
    witnessParties: [BOB],
    packageName: "explorer-testdata",
    ...overrides,
  },
});

const exercised = (overrides: Record<string, unknown> = {}) => ({
  ExercisedEvent: {
    offset: 150,
    nodeId: 0,
    contractId: "00c71c6e",
    templateId: `${PKG}:Explorer:TransferOffer`,
    choice: "Accept",
    choiceArgument: {},
    actingParties: [ALICE],
    consuming: true,
    witnessParties: [BOB, ALICE],
    lastDescendantNodeId: 1,
    ...overrides,
  },
});

const detail = (events: unknown[], viewer: readonly string[] = []) => {
  const built = buildUpdateDetail(
    { update: { Transaction: { value: { updateId: "1220ab", offset: 150, events } } } },
    viewer,
  );
  assert.equal(built.ok, true);
  const view = built.ok ? built.view : null;
  assert.equal(view?.kind, "transaction");
  return view?.kind === "transaction" ? view : null;
};

test("a witness who is not a stakeholder of the create was divulged it", () => {
  // alice exercised the choice above, so the subtree opened for her; she is on no side of this contract.
  const view = detail([exercised(), created({ witnessParties: [BOB, ALICE] })]);
  assert.deepEqual(view?.events[1]?.divulgedTo, [ALICE]);
});

test("stakeholders are not divulged anything — they are why the event exists", () => {
  const view = detail([
    created({ signatories: [BOB], observers: [ALICE], witnessParties: [BOB, ALICE] }),
  ]);
  assert.deepEqual(view?.events[0]?.divulgedTo, []);
});

test("an exercised event answers null — this response cannot tell informee from witness there", () => {
  // The target contract's signatories and the choice's observers never arrive, so the question is not
  // answered rather than guessed.
  const view = detail([exercised()]);
  assert.equal(view?.events[0]?.divulgedTo, null);
});

test("a create with no witnesses of its own divulges to nobody", () => {
  const view = detail([created({ witnessParties: [] })]);
  assert.deepEqual(view?.events[0]?.divulgedTo, []);
});

test("the viewer's own capacity on an exercised event is controller, not witness", () => {
  // alice acted on the choice. Before the capacity existed this read "witness", which says she only saw it
  // from an event above — the opposite of having exercised it.
  const view = detail([exercised()], [ALICE]);
  assert.deepEqual(view?.visibility.status === "ok" ? view.visibility.reasons : null, [
    { party: ALICE, roles: ["controller"], eventIndexes: [0] },
  ]);
});
