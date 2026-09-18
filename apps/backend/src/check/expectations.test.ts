// **What each address owes each person, and the zeros that are right.**
//
// The check runs as three fully-provisioned people today. Adding the other nine — a viewer with no rights, a
// super reader, someone the seed gave nothing — is what makes the boundary visible at all, and every one of
// them breaks a rule that used to be written as "there is at least one". These tests fix the two halves of
// the answer: the status each person is owed, and which questions cannot be put to them.
import assert from "node:assert/strict";
import test from "node:test";
import { ROUND_ONE, ROUND_TWO } from "./expectations.ts";
import type { Given, ViewerParty } from "./given.ts";
import { type Ask, runCheck } from "./run-check.ts";

// The twelve the seed will hold (phase 3 creates them). **Only the shape matters here** — the ordered party
// classification, whether they read every party, and what the seed left in front of them — so the party ids
// are stand-ins. Their rights are written out in the plan; the classification is the product's
// (core/viewer-parties/build-viewer-parties.ts).
const read = (party: string): ViewerParty => ({ party, kinds: ["CanReadAs"] });
const act = (party: string): ViewerParty => ({ party, kinds: ["CanActAs"] });
const sees = (parties: ViewerParty[], readsEveryParty = false): Given => ({
  parties,
  readsEveryParty,
  seesContracts: true,
  seesUpdates: true,
});
/** Holds a party and the seed left them nothing — neither a contract nor an update in the window. */
const empty = (parties: ViewerParty[]): Given => ({
  parties,
  readsEveryParty: false,
  seesContracts: false,
  seesUpdates: false,
});
/** Holds no party and no scope: the node reads nothing for them, so there is nothing to see either. */
const NOTHING: Given = {
  parties: [],
  readsEveryParty: false,
  seesContracts: false,
  seesUpdates: false,
};

const PEOPLE: Record<string, Given> = {
  // CanReadAs on three parties.
  alice: sees([read("p1"), read("p2"), read("p3")]),
  bob: sees([read("p2")]),
  carol: sees([read("p3")]),
  // No rights at all.
  nobody: NOTHING,
  // IdentityProviderAdmin / ParticipantAdmin name no party, and administering a participant is not a right
  // to read from it — the account holding ParticipantAdmin on the dev stack is itself answered 403 to an
  // any-party read. So these two are the same person as `nobody` as far as reading goes.
  idp: NOTHING,
  padmin: NOTHING,
  // CanActAs alone still names a party, and reading follows from it.
  actor: sees([act("p2")]),
  // CanReadAsAnyParty: reads every party, is party to none.
  super: sees([], true),
  // The same, plus one party of their own — which does not narrow the reading.
  superplus: sees([read("p2")], true),
  // CanReadAs and CanActAs on the same party collapse to **one** party carrying both capacities.
  dual: sees([{ party: "p2", kinds: ["CanReadAs", "CanActAs"] }]),
  // Two rights on two parties — the order is the rights' order, and that is the thing being tested.
  mixed: sees([read("p2"), act("p3")]),
  // One party, and the seed left them nothing.
  dave: empty([read("p4")]),
};

test("the zeros that are right are exactly twenty-three, and every one of them has a reason", () => {
  // **A question nobody asks is a question nobody checks**, so each of these has to be a stated fact rather
  // than a gap. The count is derived here rather than written down: the rules decide it, and if one of them
  // changes this number moves with it.
  const zeros: Record<string, string[]> = {};
  for (const [name, given] of Object.entries(PEOPLE)) {
    const unaskable: string[] = [];
    for (const spec of [...ROUND_ONE, ...ROUND_TWO]) {
      const why = spec.unaskable?.(given) ?? null;
      if (why !== null) unaskable.push(spec.name ?? spec.template);
    }
    if (unaskable.length > 0) zeros[name] = unaskable;
  }

  // Round one's addresses are constants — none of them can fail to be built, so none of them may be excused.
  for (const spec of ROUND_ONE) {
    assert.equal(
      spec.unaskable,
      undefined,
      `${spec.name ?? spec.template} is asked at a constant address and can never be unaskable`,
    );
  }

  // A viewer with no reading scope: the six round-two addresses all come from a list that is refused them.
  for (const name of ["nobody", "idp", "padmin"]) {
    assert.equal(zeros[name]?.length, 6, `${name} should have six`);
  }
  // A super reader is served everything and still has no party of their own to look up.
  assert.deepEqual(zeros.super, ["/api/party/{partyId}"]);
  // Holding a party as well as reading every party leaves nothing unasked.
  assert.equal(zeros.superplus, undefined);
  // Someone the seed gave nothing has no contract and no update to name — but the package catalog is every
  // installed package, and the session still names their own party, so those two are asked.
  assert.deepEqual(zeros.dave, [
    "/api/contracts/{contractId}",
    "/api/updates/{updateId}",
    "/api/updates/by-offset/{offset}",
    "/api/search",
  ]);
  for (const name of ["alice", "bob", "carol", "actor", "dual", "mixed"]) {
    assert.equal(zeros[name], undefined, `${name} should be asked everything`);
  }

  const total = Object.values(zeros).reduce((n, list) => n + list.length, 0);
  assert.equal(total, 23, `the legitimate zeros moved: ${JSON.stringify(zeros)}`);
  // Twelve people × eighteen addresses, less the zeros.
  assert.equal(12 * 18 - total, 193);
});

test("a viewer with no reading scope is served, refused and left unasked in the right places", async () => {
  // A stand-in for the node saying "no". **The 200 bodies here are deliberately minimal** — this test is
  // about which questions were put and what status came back, so findings about their content are expected
  // and are not what is asserted.
  const refuseParties: Ask = async (url) => {
    const open = ["/api/session", "/api/home", "/api/node"].some((p) => url.startsWith(p));
    if (!open) {
      return { status: 403, body: { reason: "no_party_rights" }, ledger: [] };
    }
    const body = url.startsWith("/api/session")
      ? { outcome: "view", parties: [], scope: "own" }
      : url.startsWith("/api/home")
        ? { cards: { status: "no_party_rights" } }
        : { version: { status: "ok" }, ledgerEnd: { status: "ok" } };
    return { status: 200, body, ledger: [] };
  };

  const report = await runCheck([{ name: "nobody", ask: refuseParties, given: NOTHING }], {
    iso: "2026-09-14T11:28:07.289Z",
    ms: Date.parse("2026-09-14T11:28:07.289Z"),
  });

  // Every refusal was the answer this person was owed, and the three open addresses were served.
  assert.deepEqual(
    report.findings.filter((f) => f.level === "responds"),
    [],
  );
  // And the six that could not be asked are written down with a reason rather than counted as failures.
  assert.deepEqual(
    report.notAsked.map((n) => n.url),
    [
      "/api/contracts/{contractId}",
      "/api/updates/{updateId}",
      "/api/updates/by-offset/{offset}",
      "/api/packages/{packageId}/schema",
      "/api/party/{partyId}",
      "/api/search",
    ],
  );
  for (const n of report.notAsked) assert.ok(n.why.length > 0, `${n.url} has no reason`);
  assert.equal(report.asked, 12, "the twelve round-one addresses were all put to them");
});

test("describing a person wrongly turns the check red rather than quietly green", async () => {
  // The other direction of every rule above. If saying "this person is served nothing" could only ever pass,
  // the statement would be worth nothing.
  const served: Ask = async (url) =>
    url.startsWith("/api/session")
      ? {
          status: 200,
          body: { outcome: "view", parties: [{ party: "p1" }], scope: "own" },
          ledger: [],
        }
      : { status: 200, body: { rows: [{ contractId: "c1" }], total: 1 }, ledger: [] };

  const asNobody = await runCheck(
    [
      {
        name: "x",
        ask: served,
        given: NOTHING,
      },
    ],
    { iso: "2026-09-14T11:28:07.289Z", ms: Date.parse("2026-09-14T11:28:07.289Z") },
  );
  assert.ok(
    asNobody.findings.some((f) => f.message.includes("expected 403 no_party_rights, got 200")),
    "a 200 where a refusal belongs is a defect",
  );
  assert.ok(
    asNobody.findings.some((f) => f.message.includes("said to be unaskable")),
    "an address built for someone who was said to have nothing to name it with is a defect",
  );
  assert.ok(
    asNobody.findings.some(
      (f) => f.url === "/api/session" && f.message.includes("the rights say (none)"),
    ),
    "a party in the session that the rights never granted is a defect",
  );
});

test("the session is judged on the whole classification — order and capacities, not a set of names", () => {
  // **This is why `mixed` and `dual` are in the seed at all.** Compared as a set of party names, a response
  // that reordered them or dropped one of two capacities passed, and the two people who exist to catch
  // exactly that caught nothing.
  const session = ROUND_ONE.find((spec) => spec.template === "/api/session");
  assert.ok(session !== undefined);
  const body = (parties: { party: string; kinds: string[] }[]) => ({
    outcome: "view",
    scope: "own",
    parties,
  });
  const mixed = PEOPLE.mixed as Given;
  const right = mixed.parties.map((p) => ({ party: p.party, kinds: [...p.kinds] }));
  assert.equal(
    session.filled(body(right), mixed),
    null,
    "the classification as the rights state it",
  );
  // Reordered — the rights' order is the product's own rule, so a different order is a different answer.
  assert.ok(session.filled(body([...right].reverse()), mixed) !== null, "reordered");
  // One party holding two capacities is not the same as one holding one.
  const dual = PEOPLE.dual as Given;
  assert.equal(
    session.filled(body([{ party: "p2", kinds: ["CanReadAs", "CanActAs"] }]), dual),
    null,
  );
  assert.ok(
    session.filled(body([{ party: "p2", kinds: ["CanReadAs"] }]), dual) !== null,
    "a lost capacity",
  );
  assert.ok(
    session.filled(body([{ party: "p2", kinds: ["CanActAs", "CanReadAs"] }]), dual) !== null,
    "the capacities in the other order",
  );
  // The same party twice is not the same as once.
  assert.ok(
    session.filled(body([...right, right[0] as never]), mixed) !== null,
    "a duplicated party",
  );
});
