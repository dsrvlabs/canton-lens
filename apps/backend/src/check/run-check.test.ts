// **The check, run without a node.** It calls the *same* `runCheck` that runs against a live participant —
// the only difference is what sits behind `send`. Here the real answers recorded in fixtures/ stand in the
// ledger's place.
//
// So a green light here means: **against the ledger as it was on the day it was recorded, all 16 endpoints
// answer, match the openapi contract, and have content.** It says nothing about whether the node has changed
// since: only a run against a live participant says that (and when it has, this fails with "a question that
// is not on the tape").
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
// build-app.mjs is a boot site, hence `.mjs` (executable code that uses no types) — its signature lives in
// build-app.d.mts. This test uses buildApp rather than routeRequest because the `readAt` stamp and the 405's
// Allow header are added there, and the contract declares `readAt` **required**. Calling only the router would
// fail level ② wholesale — so this test sees **exactly what the server answers**.
import { buildApp } from "../live/build-app.mjs";
import { _clearSchemaCache } from "../router.ts";
import { fakeTokenFor, parseTape, replaySend, tapeKey } from "./ledger-tape.ts";
import { type Ask, describeCoverage, formatReport, nowFrom, runCheck } from "./run-check.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");

const meta = JSON.parse(await readFile(join(FIXTURES, "meta.json"), "utf8")) as {
  recordedAt: string;
  users: string[];
  cantonVersion: string;
};
const entries = parseTape(await readFile(join(FIXTURES, "ledger.jsonl"), "utf8"));
const bytes = new Map<string, Uint8Array>();
for (const name of await readdir(join(FIXTURES, "packages"))) {
  if (name.endsWith(".bin")) bytes.set(name, await readFile(join(FIXTURES, "packages", name)));
}

test("stands up the recorded ledger and passes all three levels (three people)", async () => {
  // The schema cache is module-level, so what another test in the same process filled stays. If it does, the
  // package requests never go out and the blueprint-reading path is not checked.
  _clearSchemaCache();
  // Collect the questions that were not found. Throwing alone is not enough: the router names a throwing
  // `send` `unreachable` (504), so reading only the report diagnoses "could not reach the node".
  const misses: string[] = [];
  const app = buildApp({
    send: replaySend(entries, bytes, misses),
    ledgerAuth: { mode: "caller-bearer" },
  });
  const askAs =
    (who: string): Ask =>
    async (url) => {
      const response = await app.inject({
        method: "GET",
        url,
        headers: { authorization: `Bearer ${fakeTokenFor(who)}` },
      });
      let body: unknown = null;
      try {
        body = response.body === "" ? null : JSON.parse(response.body);
      } catch {
        body = null;
      }
      return { status: response.statusCode, body };
    };

  // **"Now" is the instant it was recorded.** Using the real clock would let the expiry times the seed planted
  // slip into the past, and one day the answers would change on their own — the ledger frozen, the clock running.
  const report = await runCheck(
    meta.users.map((name) => ({ name, ask: askAs(name) })),
    nowFrom(new Date(meta.recordedAt)),
  );
  await app.close();

  // Look at this first. When a missing tape entry is the cause, this says what actually happened —
  // "our code is asking something different from what was recorded" — where the report says "504 unreachable".
  assert.deepEqual(
    misses,
    [],
    `${misses.length} question(s) are not on the tape — if the code changed, re-record against a live participant:\n  ${misses.slice(0, 5).join("\n  ")}`,
  );
  assert.ok(report.ok, `\n${formatReport(report)}`);
  assert.equal(
    report.users.length,
    3,
    "runs as three people — with one, the fact that people see different things is invisible",
  );
  assert.ok(report.asked >= 17, `17 addresses must be asked (asked ${report.asked} times)`);
});

test("when our code asks something else it fails loudly instead of passing quietly", async () => {
  // This is why the tape exists. In the old fixtures the file name was the key, so "what was asked, and how"
  // was written down nowhere — and two paths and a body shape were wrong while every test passed.
  const send = replaySend(entries, bytes);
  await assert.rejects(
    () =>
      send({ method: "POST", path: "/v2/state/active-contracts", body: { unexpected: "shape" } }),
    /not on the tape/,
  );
  await assert.rejects(() => send({ method: "GET", path: "/v2/no-such-path" }), /not on the tape/);
});

test("no credentials are in the fixture — only people's names", async () => {
  // It has to be recorded with user tokens (to capture the boundary Canton enforces), but those tokens must
  // not end up in the repo. The design puts only a person's name in the key; this checks the files themselves.
  //
  // **Every file is scanned, not just the tape.** Reading ledger.jsonl alone, for one JWT shape plus the word
  // "authorization", would miss an opaque token under another field name, and would miss meta.json and the
  // package bytes entirely.
  const files: { name: string; text: string }[] = [];
  const walk = async (dir: string, prefix = "") => {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isDirectory()) {
        await walk(path, `${prefix}${item.name}/`);
        continue;
      }
      // Package bytes are protobuf; decoding as utf8 with replacement is fine for a substring scan.
      files.push({ name: prefix + item.name, text: await readFile(path, "utf8").catch(() => "") });
    }
  };
  await walk(FIXTURES);
  assert.ok(
    files.length > 30,
    `expected the fixture directory to hold the tape and the packages (${files.length})`,
  );

  // A JWT is three base64url segments — that shape is a credential wherever it appears, prose included.
  const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
  // A field name that carries a secret. This one runs on the **recorded data only**: README.md is prose we
  // wrote, and it legitimately talks about credentials (saying that no token is in these files). Running the
  // name heuristic over prose would only teach us to weaken it.
  const SECRET_FIELD =
    /"(access_token|refresh_token|id_token|client_secret|authorization|bearer|api[_-]?key|password|passwd|secret|credential|private[_-]?key)"\s*:/i;
  for (const file of files) {
    assert.ok(!JWT.test(file.text), `${file.name} contains something shaped like a JWT`);
    if (file.name.endsWith(".md")) continue;
    const field = SECRET_FIELD.exec(file.text);
    assert.equal(
      field,
      null,
      `${file.name} has a JSON field that carries a credential: ${field?.[0]}`,
    );
  }

  // And the key holds nothing but the people the recording was made as.
  for (const entry of entries) {
    assert.ok(meta.users.includes(entry.who), `an unknown person is in the key: ${entry.who}`);
  }
});

test("every operation openapi declares is in the check table, and every 200 schema resolves", () => {
  // **Two safety nets.** An operation missing from the table is never asked, and a 200 schema that does not
  // resolve means level ② compares nothing — both roads lead to "green while looking at nothing".
  // runCheck has its own coverage guard, but that one needs the fixture; this test runs without it. Whoever
  // adds an operation to openapi is stopped here first.
  //
  // It is keyed by **operation, not path** — a `post` added under an already-covered path used to slip past
  // entirely, because only `item.get` and the set of path strings were inspected.
  const coverage = describeCoverage();
  assert.deepEqual(
    coverage.missingFromCheck,
    [],
    "declared in openapi but absent from the check table (expectations.ts)",
  );
  assert.deepEqual(coverage.withoutValidator, [], "no 200 schema resolves through ajv for these");
  assert.equal(
    coverage.openApiOperations.length,
    18,
    "the number of operations changed — if it grew, check that the new one is in the table",
  );
  // **The write is named here rather than counted silently.** describeCoverage excludes POST from the
  // table requirement because asking a write commits a transaction (see the comment there), and an
  // exclusion nobody asserts on is an exclusion that can widen without anyone noticing. This says
  // exactly which operation is out, so a second one arriving fails here.
  assert.deepEqual(
    coverage.openApiOperations.filter((name) => name.startsWith("POST ")),
    ["POST /api/exercise"],
    "a write that is not the documented one has been declared — see docs/ledger-writes.md",
  );
});

test("the tape key follows the same rules as the wire — two different requests never share one key", () => {
  // A collided key serves one answer to two questions. That is the kind of defect that quietly returns the
  // wrong thing, so it is nailed down here.
  const key = (body: unknown) => tapeKey("alice", "POST", "/p", body);

  // Key order is not part of the key — a harmless refactor must not break the tape.
  assert.equal(key({ a: 1, b: 2 }), key({ b: 2, a: 1 }));
  assert.equal(key({ x: { a: 1, b: 2 } }), key({ x: { b: 2, a: 1 } }));
  assert.equal(key([{ a: 1, b: 2 }]), key([{ b: 2, a: 1 }]));

  // **A key whose value is `undefined` disappears on the wire** — `JSON.stringify({a:undefined})` is `{}`.
  // So `{a:undefined}` and `{a:null}` are different requests, and their keys must differ too.
  assert.equal(
    key({ a: undefined }),
    key({}),
    "an undefined key is dropped on the wire, so it is as if absent",
  );
  assert.notEqual(key({ a: null }), key({ a: undefined }), "null and undefined differ on the wire");

  // Array holes and `toJSON` follow the wire for the same reason.
  assert.notEqual(key(new Array(1)), key([]), "Array(1) serializes as [null], not []");
  assert.notEqual(key(new Date(0)), key(new Date(1)), "toJSON gives these different strings");

  // Things that must not collide.
  assert.notEqual(key({ a: 1 }), key({ a: "1" }), "a number and a string");
  assert.notEqual(key({ a: [1, 2] }), key({ a: [[1], 2] }), "nesting depth");
  assert.notEqual(key({ "a,b": 1 }), key({ a: { b: 1 } }), "a separator inside a key");
  assert.notEqual(key({ a: {} }), key({ a: [] }), "an empty object and an empty array");

  // **The person is always part of the key.** Package bytes, the ledger end and the version were briefly
  // excluded as "the same answer for everyone", which is true of the *body* and false of the *status* — the
  // ledger can answer 403 based on the token. Serving one person's authorization result to another is exactly
  // what that would do.
  assert.notEqual(
    tapeKey("alice", "GET", "/v2/state/ledger-end", null),
    tapeKey("bob", "GET", "/v2/state/ledger-end", null),
  );
  assert.notEqual(
    tapeKey("alice", "GET", `/v2/packages/${"a".repeat(64)}`, null),
    tapeKey("bob", "GET", `/v2/packages/${"a".repeat(64)}`, null),
  );
});
