import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTransferOffers } from "./build-transfer-offers.ts";

// The standard TransferInstruction view → a "received offer" row. **The chokepoint for judging expiry and
// direction** — the screen reads these values as they are and does not recompute them.
//
// This layer does not read a clock. The "now" (asOf) is measured and passed in by the caller — which is what
// lets a time-dependent judgment be pinned to a value here.
//
// **Where the inputs come from is kept distinct.** The parties and the interface id are real ones from a real
// node; the contractId (`00aa`), the amounts and the instants are invented to keep this test
// readable. This function only copies the contractId across, so how real that value is does not enter any
// judgment.
const IFACE =
  "#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction";
const A = "alice::1220a4cae93312d1211927caf3c30e5865ed5310f4d2860a00a062f77bc4dca14927";
const B = "bob::1220a4cae93312d1211927caf3c30e5865ed5310f4d2860a00a062f77bc4dca14927";
const C = "carol::1220a4cae93312d1211927caf3c30e5865ed5310f4d2860a00a062f77bc4dca14927";
const AS_OF = "2026-09-06T12:00:00.000Z";

// The shape of a real node's response as it is: viewStatus.code and viewValue.transfer inside interfaceViews[].
const offer = (o: {
  id?: string;
  sender?: unknown;
  receiver?: unknown;
  amount?: unknown;
  executeBefore?: unknown;
  instrumentId?: unknown;
  code?: number;
  message?: string;
  interfaceId?: string;
}) => ({
  contractId: o.id ?? "00aa",
  interfaceViews: [
    {
      interfaceId: o.interfaceId ?? IFACE,
      viewStatus: { code: o.code ?? 0, message: o.message ?? "", details: [] },
      viewValue: {
        transfer: {
          sender: o.sender ?? A,
          receiver: o.receiver ?? B,
          amount: o.amount ?? "10.0000000000",
          executeBefore: o.executeBefore ?? "2026-09-06T12:10:00.000Z",
          instrumentId: o.instrumentId ?? { admin: A, id: "USD" },
        },
      },
    },
  ],
});

test("before expiry, the milliseconds remaining are executeBefore − asOf", () => {
  const r = buildTransferOffers([offer({})], IFACE, AS_OF, [A, B]);
  assert.ok(r.kind === "available");
  assert.deepEqual(r.view.rows[0]?.expiry, { passed: false, remainingMs: 600_000 });
});

test("after expiry, the milliseconds elapsed are asOf − executeBefore", () => {
  const r = buildTransferOffers(
    [offer({ executeBefore: "2026-09-06T11:00:00.000Z" })],
    IFACE,
    AS_OF,
    [A, B],
  );
  assert.ok(r.kind === "available");
  assert.deepEqual(r.view.rows[0]?.expiry, { passed: true, passedByMs: 3_600_000 });
});

test("the exact same instant counts as elapsed — the boundary is settled on one side", () => {
  const r = buildTransferOffers([offer({ executeBefore: AS_OF })], IFACE, AS_OF, [A, B]);
  assert.ok(r.kind === "available");
  assert.deepEqual(r.view.rows[0]?.expiry, { passed: true, passedByMs: 0 });
});

test("a difference of one millisecond separates them", () => {
  const before = buildTransferOffers(
    [offer({ executeBefore: "2026-09-06T12:00:00.001Z" })],
    IFACE,
    AS_OF,
    [A],
  );
  assert.ok(before.kind === "available");
  assert.deepEqual(before.view.rows[0]?.expiry, { passed: false, remainingMs: 1 });
  const after = buildTransferOffers(
    [offer({ executeBefore: "2026-09-06T11:59:59.999Z" })],
    IFACE,
    AS_OF,
    [A],
  );
  assert.ok(after.kind === "available");
  assert.deepEqual(after.view.rows[0]?.expiry, { passed: true, passedByMs: 1 });
});

test("an executeBefore that is not an instant counts as elapsed with 0 elapsed — no negative is invented", () => {
  const r = buildTransferOffers([offer({ executeBefore: "sometime" })], IFACE, AS_OF, [A]);
  assert.ok(r.kind === "available");
  assert.deepEqual(r.view.rows[0]?.expiry, { passed: true, passedByMs: 0 });
});

test("an asOf that is not an instant builds nothing and is unavailable", () => {
  // The router already cuts this off with a 400, but this layer refuses it on its own too.
  assert.deepEqual(buildTransferOffers([offer({})], IFACE, "null"), {
    kind: "unavailable",
    reason: "invalid_as_of",
  });
});

test("an input that is not an array is unavailable — not flattened to an empty list", () => {
  assert.deepEqual(buildTransferOffers({ result: [] }, IFACE, AS_OF), {
    kind: "unavailable",
    reason: "contracts_not_array",
  });
});

// ── Judging direction (the chokepoint) ──────────────────────────────────────────
test("receiving is received, sending is sent", () => {
  const got = buildTransferOffers([offer({ sender: A, receiver: B })], IFACE, AS_OF, [B]);
  assert.ok(got.kind === "available");
  assert.deepEqual(got.view.rows[0]?.directionInfo, { direction: "received" });
  const sent = buildTransferOffers([offer({ sender: A, receiver: B })], IFACE, AS_OF, [A]);
  assert.ok(sent.kind === "available");
  assert.deepEqual(sent.view.rows[0]?.directionInfo, { direction: "sent" });
});

test("between my own parties it is internal — this arises for someone reading several parties", () => {
  // alice reads three: alice·treasury·ops (the real stack). treasury→alice is this case.
  const r = buildTransferOffers([offer({ sender: A, receiver: B })], IFACE, AS_OF, [A, B]);
  assert.ok(r.kind === "available");
  assert.deepEqual(r.view.rows[0]?.directionInfo, { direction: "internal" });
});

test("neither side being my party is third_party", () => {
  const r = buildTransferOffers([offer({ sender: A, receiver: B })], IFACE, AS_OF, [C]);
  assert.ok(r.kind === "available");
  assert.deepEqual(r.view.rows[0]?.directionInfo, { direction: "third_party" });
});

test("no viewer parties, or an empty list, is unknown plus a reason — no direction is invented", () => {
  const none = buildTransferOffers([offer({})], IFACE, AS_OF);
  assert.ok(none.kind === "available");
  assert.deepEqual(none.view.rows[0]?.directionInfo, {
    direction: "unknown",
    reason: "viewer_parties_not_provided",
  });
  const empty = buildTransferOffers([offer({})], IFACE, AS_OF, []);
  assert.ok(empty.kind === "available");
  assert.deepEqual(empty.view.rows[0]?.directionInfo, {
    direction: "unknown",
    reason: "viewer_parties_empty",
  });
});

// ── When the view is absent or in error ─────────────────────────────────────────
test("a contract with no view for this interface is skipped quietly — zero rows is not a failure", () => {
  const other = offer({ interfaceId: "#other-package:M:E" });
  const r = buildTransferOffers([other, { contractId: "00bb" }, {}], IFACE, AS_OF, [A]);
  assert.ok(r.kind === "available");
  assert.deepEqual(r.view, { rows: [], problems: [] });
});

test("a view in error (code≠0) leaves a problem rather than inventing a value", () => {
  const r = buildTransferOffers([offer({ id: "00cc", code: 3, message: "boom" })], IFACE, AS_OF, [
    A,
  ]);
  assert.ok(r.kind === "available");
  assert.equal(r.view.rows.length, 0);
  assert.deepEqual(r.view.problems, [
    { contractId: "00cc", interfaceId: IFACE, code: 3, message: "boom", details: [] },
  ]);
});

test("code 0 with a malformed field shape is a problem — an untrustworthy value does not become a row", () => {
  const r = buildTransferOffers([offer({ id: "00dd", amount: 10 })], IFACE, AS_OF, [A]);
  assert.ok(r.kind === "available");
  assert.equal(r.view.rows.length, 0);
  assert.equal(r.view.problems[0]?.message, "view_value_shape_mismatch");
  assert.equal(r.view.problems[0]?.code, 0, "it records the fact that the view itself succeeded");
});

// ── The rules for carrying values across ────────────────────────────────────────
test("an amount is carried as the original string — it is not parsed", () => {
  const r = buildTransferOffers([offer({ amount: "1000000.0000000000" })], IFACE, AS_OF, [A]);
  assert.ok(r.kind === "available");
  assert.equal(r.view.rows[0]?.amount, "1000000.0000000000");
});

test("a standard InstrumentId record yields only its id, and one that arrived as Text is left as is", () => {
  const rec = buildTransferOffers(
    [offer({ instrumentId: { admin: A, id: "USD" } })],
    IFACE,
    AS_OF,
    [A],
  );
  assert.ok(rec.kind === "available");
  assert.equal(rec.view.rows[0]?.instrumentId, "USD");
  const text = buildTransferOffers([offer({ instrumentId: "EUR" })], IFACE, AS_OF, [A]);
  assert.ok(text.kind === "available");
  assert.equal(text.view.rows[0]?.instrumentId, "EUR");
});

test("asking by name form also finds a view that arrived in hash form — but the hash is **not compared**", () => {
  // Naming it in the name form (#pkg:…) while the response arrives in hash form really does happen. This
  // layer cannot know which hash is the package of that name, so it treats them as the same when only
  // module/entity match (the rule of interfaceIdsMatch). So **any hash passes** — that is the contract today.
  const anyHash = `${"a".repeat(64)}:Splice.Api.Token.TransferInstructionV1:TransferInstruction`;
  const found = buildTransferOffers([offer({ interfaceId: anyHash })], IFACE, AS_OF, [A]);
  assert.ok(found.kind === "available");
  assert.equal(found.view.rows.length, 1);
  // A different module or entity is not found — that is the limit of this match.
  const otherEntity = `${"a".repeat(64)}:Splice.Api.Token.TransferInstructionV1:SomethingElse`;
  const miss = buildTransferOffers([offer({ interfaceId: otherEntity })], IFACE, AS_OF, [A]);
  assert.ok(miss.kind === "available");
  assert.equal(miss.view.rows.length, 0);
});

test("a flat view (the old imitation standard) is read too — both shapes really existed", () => {
  const flat = {
    contractId: "00ee",
    interfaceViews: [
      {
        interfaceId: IFACE,
        viewStatus: { code: 0, message: "", details: [] },
        viewValue: {
          sender: A,
          receiver: B,
          amount: "5.0",
          executeBefore: "2026-09-06T12:05:00.000Z",
          instrumentId: "USD",
        },
      },
    ],
  };
  const r = buildTransferOffers([flat], IFACE, AS_OF, [A, B]);
  assert.ok(r.kind === "available");
  assert.equal(r.view.rows[0]?.amount, "5.0");
  assert.deepEqual(r.view.rows[0]?.expiry, { passed: false, remainingMs: 300_000 });
});
