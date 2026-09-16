import assert from "node:assert/strict";
import test from "node:test";
import type { PackageSchema } from "@canton-lens/core";
import type { LedgerAuthConfig } from "./auth/config.ts";
import { type ExerciseDeps, handleExercise } from "./exercise-route.ts";
import type { RouterRequest } from "./router-types.ts";
import { readLedgerWriteConfig } from "./write-config.ts";

const ALICE = "alice::1220abcdef";
const BOB = "bob::1220fedcba";
const TEMPLATE_ID = "0123456789abcdef:Iou:Iou";

const schema: PackageSchema = {
  packageId: "0123456789abcdef",
  lfVersion: "2.1",
  name: "iou",
  version: "1.0.0",
  modules: [
    {
      name: "Iou",
      templates: [
        {
          module: "Iou",
          name: "Iou",
          fields: [],
          choices: [
            {
              name: "Iou_Transfer",
              consuming: true,
              argType: "Iou_Transfer",
              argFields: [
                {
                  name: "newOwner",
                  type: "Party",
                  lfType: { kind: "builtin", name: "Party", args: [] },
                },
              ],
              returnType: null,
            },
          ],
          key: null,
          implements: [],
        },
      ],
      interfaces: [],
      dataTypes: [],
    },
  ],
} as unknown as PackageSchema;

const request = (over: Partial<RouterRequest> = {}): RouterRequest => ({
  method: "POST",
  path: "/api/exercise",
  query: {},
  ledgerToken: "token",
  body: {
    contractId: "00abc",
    templateId: TEMPLATE_ID,
    choice: "Iou_Transfer",
    argument: { newOwner: BOB },
    actAs: [ALICE],
  },
  ...over,
});

const deps = (over: Partial<ExerciseDeps> = {}): ExerciseDeps => ({
  send: async () => ({ status: 200, body: { updateId: "u1", completionOffset: 42 } }),
  writes: { writes: "enabled" },
  loadSchema: async () => ({ status: "ok", schema }),
  newCommandId: () => "fixed-command-id",
  ...over,
});

test("writes are refused when the deployment has not opened them, before the token is looked at", async () => {
  const response = await handleExercise(
    request({ ledgerToken: null }),
    deps({ writes: { writes: "refused" } }),
  );
  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { reason: "writes_not_available" });
});

test("a refused deployment answers the same way to a malformed body as to a well-formed one", async () => {
  // Answering differently would tell an unauthenticated caller which deployments could be written to.
  const refused = deps({ writes: { writes: "refused" } });
  const wellFormed = await handleExercise(request(), refused);
  const malformed = await handleExercise(request({ body: { nonsense: true } }), refused);
  assert.deepEqual(wellFormed, malformed);
});

test("an open deployment still refuses an unauthenticated caller", async () => {
  const response = await handleExercise(request({ ledgerToken: null }), deps());
  assert.equal(response.status, 401);
});

test("a body carrying a key this route does not implement is refused, not silently dropped", async () => {
  const response = await handleExercise(
    request({
      body: {
        contractId: "00abc",
        templateId: TEMPLATE_ID,
        choice: "Iou_Transfer",
        argument: {},
        actAs: [ALICE],
        readAs: [BOB],
      },
    }),
    deps(),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { reason: "invalid_body" });
});

test("a template id that is not <package>:<module>:<entity> is a 400, not a ledger round trip", async () => {
  let sent = false;
  const response = await handleExercise(
    request({ body: { ...(request().body as object), templateId: "Iou" } }),
    deps({
      send: async () => {
        sent = true;
        return { status: 200, body: {} };
      },
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(sent, false, "nothing reaches the participant on a malformed template id");
});

test("a choice argument the schema refuses never reaches the participant", async () => {
  let sent = false;
  const response = await handleExercise(
    request({ body: { ...(request().body as object), argument: { newOwner: "not-a-party" } } }),
    deps({
      send: async () => {
        sent = true;
        return { status: 200, body: {} };
      },
    }),
  );
  assert.equal(response.status, 400);
  assert.equal((response.body as { reason: string }).reason, "invalid_argument");
  assert.equal(sent, false);
});

test("a committed command answers with the update id the participant returned", async () => {
  let body: unknown = null;
  const response = await handleExercise(
    request(),
    deps({
      send: async (req) => {
        body = req.body;
        return { status: 200, body: { updateId: "u-9", completionOffset: 7 } };
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { updateId: "u-9", completionOffset: 7 });
  assert.deepEqual((body as { actAs: string[] }).actAs, [ALICE]);
  assert.deepEqual(
    (body as { readAs: string[] }).readAs,
    [],
    "readAs stays empty; widening it would hide a disclosure problem behind a submission",
  );
  assert.equal((body as { commandId: string }).commandId, "fixed-command-id");
});

test("a 200 with no update id is not reported as a committed transaction", async () => {
  const response = await handleExercise(
    request(),
    deps({ send: async () => ({ status: 200, body: { accepted: true } }) }),
  );
  assert.equal(response.status, 502);
});

test("the participant's refusal is relayed rather than reshaped", async () => {
  const response = await handleExercise(
    request(),
    deps({ send: async () => ({ status: 403, body: {} }) }),
  );
  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { reason: "forbidden" });
});

test("LEDGER_WRITES is off unless named, and only one spelling opens it", () => {
  const caller: LedgerAuthConfig = { mode: "caller-bearer" };
  assert.deepEqual(readLedgerWriteConfig({}, caller), { writes: "refused" });
  assert.deepEqual(readLedgerWriteConfig({ LEDGER_WRITES: "" }, caller), { writes: "refused" });
  assert.deepEqual(readLedgerWriteConfig({ LEDGER_WRITES: "enabled" }, caller), {
    writes: "enabled",
  });
  for (const value of ["true", "1", "yes", "on", "ENABLED"]) {
    assert.throws(
      () => readLedgerWriteConfig({ LEDGER_WRITES: value }, caller),
      /LEDGER_WRITES=enabled/,
      `${value} must not open a write path`,
    );
  }
});

test("shared-identity cannot open writes — it fails startup rather than starting misnamed", () => {
  const shared: LedgerAuthConfig = {
    mode: "shared-identity",
    issuer: "https://idp.example",
    clientId: "id",
    clientSecret: "secret",
    scopes: "s",
    insecureHttpHosts: [],
  };
  assert.deepEqual(readLedgerWriteConfig({}, shared), { writes: "refused" });
  assert.throws(
    () => readLedgerWriteConfig({ LEDGER_WRITES: "enabled" }, shared),
    /shared-identity/,
    "a deployment whose configuration says writes and whose behaviour refuses them must not start",
  );
});
