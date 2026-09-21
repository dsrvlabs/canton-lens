// **The check, run without a node.** It calls the *same* `runCheck` that runs against a live participant —
// the only difference is what sits behind `send`. Here the real answers recorded in fixtures/ stand in the
// ledger's place.
//
// So a green light here means: **against the ledger as it was on the day it was recorded, all 17 addresses
// answer, match the openapi contract, have content, and — where rules have been written for them — say only
// what the node gave them.** It says nothing about whether the node has changed
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
import { matchRoute, ROUTES } from "../routes.ts";
import { ROUND_ONE, ROUND_TWO } from "./expectations.ts";
import { type Given, partiesFromRights } from "./given.ts";
import { fakeTokenFor, parseTape, replaySend, tapeKey } from "./ledger-tape.ts";
import { type AnyRule, coverage, differences, inlineShapes } from "./mapping.ts";
import { MAPPINGS } from "./mappings/index.ts";
import type { OwnSet } from "./own-set.ts";
import { PROBES, type ProbeMaterial } from "./probes.ts";
import { type Ask, describeCoverage, formatReport, nowFrom, runCheck } from "./run-check.ts";
import { tracingSend } from "./trace.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");

// **The manifest beside the tape.** It says who was recorded and what each of them was given — the party
// classification their rights imply, and whether the seed left them anything to see. The check reads this
// rather than assuming; before the manifest existed every recorded person was assumed to hold data, and a
// person the seed gave nothing would have been judged as one who holds some.
const meta = JSON.parse(await readFile(join(FIXTURES, "meta.json"), "utf8")) as {
  recordedAt: string;
  cantonVersion: string;
  people: (Given & { name: string; probes: ProbeMaterial })[];
};
// **The answer key** — what the node said each person can see, asked with their token and not through this
// application (check/own-set.ts). Every other input here is the node's answer to *our* question, so a
// narrowed question shrinks the tape, the answer and the expectation together and all three agree. This is
// the only thing outside that loop.
const own = JSON.parse(await readFile(join(FIXTURES, "own-set.json"), "utf8")) as OwnSet;
const entries = parseTape(await readFile(join(FIXTURES, "ledger.jsonl"), "utf8"));
const bytes = new Map<string, Uint8Array>();
for (const name of await readdir(join(FIXTURES, "packages"))) {
  if (name.endsWith(".bin")) bytes.set(name, await readFile(join(FIXTURES, "packages", name)));
}

test("stands up the recorded ledger and passes every level (twelve people)", async () => {
  // The schema cache is module-level, so what another test in the same process filled stays. If it does, the
  // package requests never go out and the blueprint-reading path is not checked.
  _clearSchemaCache();
  // Collect the questions that were not found. Throwing alone is not enough: the router names a throwing
  // `send` `unreachable` (504), so reading only the report diagnoses "could not reach the node".
  const misses: string[] = [];
  // **The clock is handed in too.** `readAt` is stamped on every 200 by the boot file, and the rules
  // (check/mappings/) have to say what it should be — against the real clock there is no such thing.
  const recordedAt = new Date(meta.recordedAt);
  // One more wrapper on the way out, so the check can see what the node was asked for each address. Nothing
  // else changes: the request still goes through routing, authentication and the handler.
  const tracer = tracingSend(replaySend(entries, bytes, misses));
  const app = buildApp({
    send: tracer.send,
    ledgerAuth: { mode: "caller-bearer" },
    now: () => recordedAt,
  });
  const askAs =
    (who: string): Ask =>
    async (url) => {
      // Cleared before, taken after — that is also what groups "the node calls this one address made".
      tracer.take();
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
      return { status: response.statusCode, body, ledger: tracer.take() };
    };

  // **"Now" is the instant it was recorded.** Using the real clock would let the expiry times the seed planted
  // slip into the past, and one day the answers would change on their own — the ledger frozen, the clock running.
  const report = await runCheck(
    // The tape's stand-in tokens are not JWTs — there is nothing to decode and nothing to echo, so the
    // session answer's token claims are null for everyone here. A live run against a participant passes the
    // real payload and the same rule then has something to compare.
    meta.people.map((person) => ({
      name: person.name,
      ask: askAs(person.name),
      given: person,
      tokenPayload: null,
      // Recorded beside the tape by asking the node directly — "a contract this person cannot see" is
      // exactly the thing our own answers would be wrong about if the defect were there.
      probes: person.probes,
    })),
    nowFrom(recordedAt),
    { own, tapeOffset: own.atOffset },
  );
  await app.close();

  // Look at this first. When a missing tape entry is the cause, this says what actually happened —
  // "our code is asking something different from what was recorded" — where the report says "504 unreachable".
  assert.deepEqual(
    misses,
    [],
    `${misses.length} question(s) are not on the tape — our code is asking something different from when it\n` +
      `was recorded. If the code is right this is not your mistake: a maintainer re-records the tape against a\n` +
      `live participant. Say in your pull request that the tape needs re-recording.\n  ${misses.slice(0, 5).join("\n  ")}`,
  );
  assert.ok(report.ok, `\n${formatReport(report)}`);
  // **Twelve, not three.** The three who came first all hold ordinary read rights on parties of their own,
  // and that is the one shape whose answers reveal the least. The other nine are the shapes the product's
  // viewer classification can tell apart: no rights at all, an administrative right that is not a reading
  // right, act-as alone, both capacities on one party, two rights on two parties, a reader of every party
  // with and without a party of their own, and a person the seed left nothing.
  assert.equal(
    report.users.length,
    12,
    "runs as twelve people — the boundary is only visible where the people differ",
  );
  // **Two tables, two counts, both derived rather than observed.**
  //   the addresses:  21 × 12 = 252, less the 27 that legitimately cannot be put to someone → 225
  //   the probes:     15 kinds × 12 = 180, less the 29 nobody has the material for → 151
  // Both breakdowns are worked out person by person in expectations.test.ts; a number that moves without a
  // person's shape changing is the thing these assertions exist to catch.
  const PROBE_KINDS = PROBES.reduce((n, probe) => n + probe.kinds.length, 0);
  assert.equal(PROBE_KINDS, 15, "the probe matrix changed shape");
  assert.equal(report.asked, 225 + 151, `asked ${report.asked} times`);
  assert.equal(
    report.notAsked.length,
    27 + 29,
    `${report.notAsked.length} were rightly not asked — both counts are derived in expectations.test.ts`,
  );
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
  const named = meta.people.map((p) => p.name);
  for (const entry of entries) {
    assert.ok(named.includes(entry.who), `an unknown person is in the key: ${entry.who}`);
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
    17,
    "the number of operations changed — if it grew, check that the new one is in the table",
  );
});

test("the router, openapi and the check table name the same addresses", () => {
  // **Three lists, one set.** Until the router's addresses were a value (`routes.ts`) this could not be
  // asked at all: the set lived as sixteen booleans inside the dispatch, so an address could be answered and
  // undocumented, or documented and unanswered, and every test stayed green. Each direction is its own
  // failure, so each is asserted separately rather than as one set equality.
  const coverage = describeCoverage();
  assert.deepEqual(
    coverage.missingFromRouter,
    [],
    "openapi declares these but the router has no such address — they would answer 404",
  );
  assert.deepEqual(
    coverage.undocumented,
    [],
    "the router answers these but openapi does not declare them — undocumented and unchecked",
  );
  assert.deepEqual(
    coverage.askedButUndocumented,
    [],
    "the check table asks for these and openapi declares none of them",
  );
  assert.equal(
    coverage.routerOperations.length,
    17,
    "the number of operations the router answers changed",
  );
  // The templates are compared character for character on purpose — `{updateId}` against `{updateId}`. A
  // translation between the two notations would be a place for them to drift while this stays green.
  assert.deepEqual([...coverage.routerOperations].sort(), [...coverage.openApiOperations].sort());
});

/** One real-looking address for a template — `/api/updates/{updateId}` becomes `/api/updates/1220ff`. */
const filled = (template: string): string =>
  template
    .replace("{contractId}", "00abc")
    .replace("{partyId}", "alice::1220")
    .replace("{updateId}", "1220ff")
    .replace("{offset}", "168")
    .replace("{packageId}", "a".repeat(64));

test("every address in the route list matches its own template, and nothing else's", () => {
  // The list is only a set of addresses if each pattern recognises the path its template names. A typo in a
  // pattern would otherwise be invisible: the template would still be counted, and the path would 404.
  for (const route of ROUTES) {
    const example = filled(route.template);
    const found = matchRoute(example);
    assert.equal(found?.template, route.template, `${example} should be ${route.template}`);
  }
  // **And rejects what its template does not name.** One positive example per route says the pattern is not
  // a typo; it does not say the pattern is not *wider* than the address. Dropping a single `$` turned
  // `/api/session` into a prefix and made `/api/session-anything` an undocumented alias of it, with every
  // test still green (2026-09-18 codex).
  for (const route of ROUTES) {
    const example = filled(route.template);
    // A route with a `{parameter}` legitimately takes any one segment there, so `…/00abcx` is simply
    // another contract id. What no route may take is **an extra segment** or **anything in front**; and a
    // route with no parameter at all may take nothing appended either. It may well be *another* route
    // (`/api/contracts/more` is a contract id) — it must not be this one.
    const takesNoParameter = !route.template.includes("{");
    const wider = [
      `${example}/more`,
      `x${example}`,
      ...(takesNoParameter ? [`${example}x`, `${example}-anything`] : []),
    ];
    for (const path of wider) {
      assert.notEqual(
        matchRoute(path)?.template,
        route.template,
        `${path} is not ${route.template} and must not match it`,
      );
    }
  }

  assert.equal(matchRoute("/api/nothing"), null);
  assert.equal(matchRoute("/api/contracts/"), null, "an empty segment is not an address");
  // A package id is a content hash; a path that is not one is not this address (and must not become the
  // catch-all `/api/updates/{updateId}` or anything else either).
  assert.equal(matchRoute("/api/packages/xyz/schema"), null);
  assert.equal(
    matchRoute("/api/updates/by-offset/168")?.template,
    "/api/updates/by-offset/{offset}",
    "the two-segment form must not be read as an update id",
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

test("every mapping describes every slot the contract lets its answer reach", () => {
  // **This is what stops a mapping from describing six slots of forty and passing.** The list of schemas is
  // taken from openapi, not written here, so a slot added to the contract has nowhere to hide: it arrives as
  // "no rule" the moment it exists.
  for (const [address, mapping] of Object.entries(MAPPINGS)) {
    const problems = coverage(mapping).map(
      (p) => `${p.schema}${p.slot === undefined ? "" : `.${p.slot}`} — ${p.message}`,
    );
    assert.deepEqual(problems, [], `${address}\n  ${problems.join("\n  ")}`);
  }
});

test("every address has its answer written out again by hand", () => {
  // **The end of phase four, stated as a test.** Until now a path with no mapping was judged by the first
  // three levels only — it responds, it matches the contract, the slots are filled — and none of those says
  // the *values* are the ones the rules call for. Every path has a mapping now, and a new one arriving
  // without one is caught here rather than passing quietly.
  const mapped = new Set(Object.keys(MAPPINGS));
  const missing = [...ROUND_ONE, ...ROUND_TWO]
    .map((spec) => spec.name ?? spec.template)
    .filter((name) => !mapped.has(name));
  assert.deepEqual(
    missing,
    [],
    "these addresses are asked but nobody wrote down what the answer should hold",
  );
});

test("the shapes with no name of their own are these, and a new one gets looked at", () => {
  // **Where "every slot has a hand-written rule" stops being true.** A slot whose schema is written inline
  // in openapi — an object or a union with no name — has nowhere to hang a table, so coverage cannot demand
  // a sentence for the fields inside it. They are still compared (the parent's rule builds the whole value
  // and the comparator reads every key) and still validated by level ②, but a new *optional* inline field
  // could arrive, never appear in the fixture, and nobody would be asked to write anything (2026-09-18
  // codex). Naming the type in responses.ts or in core moves the shape back under the rule; until then it
  // is listed here, so a new one is an edit somebody reviews.
  const found: string[] = [];
  for (const [address, mapping] of Object.entries(MAPPINGS)) {
    for (const where of inlineShapes(mapping)) found.push(`${address} ${where}`);
  }
  assert.deepEqual([...new Set(found)].sort(), [
    // `VisibilityExplanation | { status: "not_asked" }`. The named half has a table; the inline half is a
    // branch the router cannot produce, because it always passes the viewer's parties.
    "/api/contracts/{contractId} ContractDetailResponse.visibility",
    // Three slots: userId, partyCount, scope. The mapping has a table for it; openapi has no name.
    "/api/home HomeResponse.viewer",
    // The three-way ok · no_party_found · no_own_parties union, built by hand in the parent's rule.
    "/api/updates/by-offset/{offset} UpdateDetailResponse(transaction).visibility",
    "/api/updates/{updateId} UpdateDetailResponse(transaction).visibility",
  ]);
});

test("the slots no mapping judges are these, and nobody adds one quietly", () => {
  // **The escape hatch, listed by name.** A rule may decline a slot when the independent restatement would
  // *be* the product — a package's table of contents is whatever its bytes decode to, and writing that rule
  // again means writing a second Daml-LF decoder. The abstention is honest; leaving it invisible would not
  // be. So every one of them is written out here, and adding one is an edit somebody reviews.
  const declined: string[] = [];
  const visit = (address: string, schema: string, table: Record<string, AnyRule>) => {
    for (const [slot, rule] of Object.entries(table)) {
      if (rule.origin === "unjudged") declined.push(`${address} ${schema}.${slot}`);
    }
  };
  for (const [address, mapping] of Object.entries(MAPPINGS)) {
    for (const [schema, table] of Object.entries(mapping.slots)) {
      const branches = table as { by?: unknown; of?: { slots: Record<string, AnyRule> }[] };
      if (typeof branches.by === "string" && Array.isArray(branches.of)) {
        for (const entry of branches.of) visit(address, schema, entry.slots);
      } else {
        visit(address, schema, table as Record<string, AnyRule>);
      }
    }
  }
  // Two reasons, and no third. Most are a value the package bytes decode to. The two `tree` slots are the
  // other: a placement derived over the whole event list (core's nest-update-events.ts), which a rule that
  // sees one event cannot restate. A new entry with a reason outside these two is the thing this test exists
  // to make somebody look at.
  assert.deepEqual(declined.sort(), [
    "/api/catalog/packages PackageRow.interfaces",
    "/api/catalog/packages PackageRow.lfVersion",
    "/api/catalog/packages PackageRow.name",
    "/api/catalog/packages PackageRow.schemaStatus",
    "/api/catalog/packages PackageRow.templates",
    "/api/catalog/packages PackageRow.version",
    "/api/catalog/templates TemplateRow.definition",
    "/api/contracts/{contractId} ContractDetailResponse.schema",
    "/api/packages/{packageId}/schema PackageSchemaResponse.counts",
    "/api/packages/{packageId}/schema PackageSchemaResponse.lfVersion",
    "/api/packages/{packageId}/schema PackageSchemaResponse.modules",
    "/api/packages/{packageId}/schema PackageSchemaResponse.name",
    "/api/packages/{packageId}/schema PackageSchemaResponse.version",
    "/api/updates/by-offset/{offset} UpdateDetailEventWithSchema.choiceSchema",
    "/api/updates/by-offset/{offset} UpdateDetailEventWithSchema.schemaStatus",
    "/api/updates/by-offset/{offset} UpdateDetailEventWithSchema.templateSchema",
    "/api/updates/by-offset/{offset} UpdateDetailEventWithSchema.tree",
    "/api/updates/{updateId} UpdateDetailEventWithSchema.choiceSchema",
    "/api/updates/{updateId} UpdateDetailEventWithSchema.schemaStatus",
    "/api/updates/{updateId} UpdateDetailEventWithSchema.templateSchema",
    "/api/updates/{updateId} UpdateDetailEventWithSchema.tree",
  ]);
});

test("a union of branches is described branch by branch, or it is reported", () => {
  // **A union is where a mapping can look complete and describe one shape of four.** `ContractKeyView` is
  // two branches told apart by `kind`; these cases pin down that the form notices each way of getting it
  // wrong. Named against the real contract, so a change to that schema arrives here.
  const rule = { says: "x", origin: "app" as const, from: () => null };
  const complete = {
    root: "ContractKeyView",
    slots: {
      ContractKeyView: {
        by: "kind",
        of: [
          { when: ["none"], slots: { kind: rule } },
          { when: ["present"], slots: { kind: rule, value: rule } },
        ],
      },
    },
  };
  assert.deepEqual(coverage(complete), []);

  const oneBranchMissing = {
    root: "ContractKeyView",
    slots: { ContractKeyView: { by: "kind", of: [{ when: ["none"], slots: { kind: rule } }] } },
  };
  assert.deepEqual(
    coverage(oneBranchMissing).map((p) => p.message),
    ["no table for kind present"],
  );

  const slotMissing = {
    root: "ContractKeyView",
    slots: {
      ContractKeyView: {
        by: "kind",
        of: [
          { when: ["none"], slots: { kind: rule } },
          { when: ["present"], slots: { kind: rule } },
        ],
      },
    },
  };
  assert.deepEqual(
    coverage(slotMissing).map((p) => `${p.schema}.${p.slot} — ${p.message}`),
    ["ContractKeyView(present).value — no rule"],
  );

  // Describing a union as if it were one shape is its own mistake: every branch would go unchecked.
  const asOneShape = {
    root: "ContractKeyView",
    slots: { ContractKeyView: { kind: rule, value: rule } },
  };
  assert.equal(coverage(asOneShape).length, 1);
  assert.match(coverage(asOneShape)[0]?.message ?? "", /described as one shape/);

  // And a branch nobody declares must not sit there unnoticed either.
  const extraBranch = {
    root: "ContractKeyView",
    slots: {
      ContractKeyView: {
        by: "kind",
        of: [
          { when: ["none"], slots: { kind: rule } },
          { when: ["present"], slots: { kind: rule, value: rule } },
          { when: ["invented"], slots: { kind: rule } },
        ],
      },
    },
  };
  assert.deepEqual(
    coverage(extraBranch).map((p) => p.message),
    ["a branch for kind invented the contract does not declare"],
  );
});

test("the comparison tells apart the things that look the same", () => {
  // The comparator is the whole of level ④, so the ways it could be quietly blind are pinned down here.
  // Each of these passed some earlier, looser comparison.
  assert.deepEqual(differences({ a: 1 }, { a: 1 }), []);
  // A key we did not expect is a difference. Reading only our own keys would miss a value the API invented.
  assert.equal(differences({ a: 1 }, { a: 1, b: 2 }).length, 1, "an extra key");
  // Absent and null are different answers — `additionalProperties`/`required` treat them differently and so
  // does every screen that asks "is this known?".
  assert.equal(differences({ a: null }, {}).length, 1, "null against absent");
  assert.equal(differences({}, { a: null }).length, 1, "absent against null");
  // A number and its string are different answers; so are a one-element list and the element.
  assert.equal(differences({ a: 1 }, { a: "1" }).length, 1, "a number and a string");
  assert.equal(differences({ a: [1] }, { a: 1 }).length, 1, "a list and a value");
  assert.ok(differences([1, 2], [1]).length >= 1, "a shorter list");
});

test("the manifest's classification is the one the node's own rights answer produces", () => {
  // **The manifest is declared, so something has to hold it to the node.** Every value in it that can be
  // derived from what the participant said is derived here and compared. What is left — whether the seed put
  // anything in front of this person — is the part no recorded answer of ours can establish, and the
  // independent recording (check/own-set.ts) is what will eventually stand behind it.
  for (const person of meta.people) {
    const rights = entries.find(
      (e) => e.who === person.name && e.path.endsWith("/rights"),
    )?.response;
    assert.ok(rights !== undefined, `${person.name}: the tape holds no rights answer`);
    const fromNode = partiesFromRights(rights);
    assert.deepEqual(
      fromNode.parties.map((p) => ({ party: p.party, kinds: [...p.kinds] })),
      person.parties.map((p) => ({ party: p.party, kinds: [...p.kinds] })),
      `${person.name}: the manifest and the node's rights disagree about the parties`,
    );
    assert.equal(
      fromNode.readsEveryParty,
      person.readsEveryParty,
      `${person.name}: the manifest and the node's rights disagree about the scope`,
    );
  }
});
