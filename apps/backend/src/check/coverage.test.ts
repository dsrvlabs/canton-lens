// **The slot list, regenerated and compared.**
//
// It runs the same check the replay test runs, then asks which of the contract's slots anything actually ran
// a rule over. The answer goes in a committed file, and this requires the file to match — so a branch that
// stopped being reached is a line in a diff rather than a silence.
//
// Run with the environment variable to regenerate it (`node --test` runs each file in a child process, so a
// flag on the command line does not reach here):
//   WRITE_UNJUDGED_SLOTS=1 node --test src/check/coverage.test.ts
import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildApp } from "../live/build-app.mjs";
import { _clearSchemaCache } from "../router.ts";
import { slotStandings, writeStandings } from "./coverage.ts";
import type { Given } from "./given.ts";
import { fakeTokenFor, parseTape, replaySend } from "./ledger-tape.ts";
import { forgetSlotsRunOver, slotsRunOver } from "./mapping.ts";
import type { OwnSet } from "./own-set.ts";
import type { ProbeMaterial } from "./probes.ts";
import { type Ask, nowFrom, runCheck } from "./run-check.ts";
import { tracingSend } from "./trace.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");
const LIST = join(HERE, "unjudged-slots.md");

const meta = JSON.parse(await readFile(join(FIXTURES, "meta.json"), "utf8")) as {
  recordedAt: string;
  people: (Given & { name: string; probes: ProbeMaterial })[];
};
const own = JSON.parse(await readFile(join(FIXTURES, "own-set.json"), "utf8")) as OwnSet;
const entries = parseTape(await readFile(join(FIXTURES, "ledger.jsonl"), "utf8"));
const bytes = new Map<string, Uint8Array>();
for (const name of await readdir(join(FIXTURES, "packages"))) {
  if (name.endsWith(".bin")) bytes.set(name, await readFile(join(FIXTURES, "packages", name)));
}

test("every slot a rule was written for, and whether anything ran it", async () => {
  _clearSchemaCache();
  forgetSlotsRunOver();
  const recordedAt = new Date(meta.recordedAt);
  const tracer = tracingSend(replaySend(entries, bytes));
  const app = buildApp({
    send: tracer.send,
    ledgerAuth: { mode: "caller-bearer" },
    now: () => recordedAt,
  });
  const askAs =
    (who: string): Ask =>
    async (url) => {
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
  const report = await runCheck(
    meta.people.map((person) => ({
      name: person.name,
      ask: askAs(person.name),
      given: person,
      tokenPayload: null,
      probes: person.probes,
    })),
    nowFrom(recordedAt),
    { own, tapeOffset: own.atOffset },
  );
  await app.close();
  // A failing run judges fewer slots, so the list would shrink for a reason that has nothing to do with
  // coverage. Say which it is rather than let this fail as though a branch had gone missing.
  assert.ok(report.ok, "the check itself failed — fix that before reading this list");

  const standings = slotStandings(slotsRunOver());
  assert.ok(
    standings.length > 300,
    `only ${standings.length} slots were found — the walk collapsed`,
  );

  const written = writeStandings(standings);
  if (process.env.WRITE_UNJUDGED_SLOTS === "1") {
    await writeFile(LIST, written);
    return;
  }
  const committed = await readFile(LIST, "utf8").catch(() => "");
  assert.equal(
    written,
    committed,
    "the slots nothing judges have changed — regenerate with `WRITE_UNJUDGED_SLOTS=1 node --test src/check/coverage.test.ts` and read the diff",
  );
});

test("a slot nothing judged is not the same as a slot nothing describes", () => {
  // The two failures this file could be confused for. `coverage()` already refuses a mapping with a slot
  // missing altogether; what is listed here has a rule and no occasion to run it. A standing with no rule
  // would mean both guards had been removed at once, so it says so in its own words.
  const standings = slotStandings(new Map());
  assert.ok(
    standings.every((one) => one.says !== "no rule describes this slot"),
    "a slot the contract declares has no rule at all — coverage() should have refused that first",
  );
  // And with nothing run, nothing is judged — the list is only as true as the run that fills it.
  assert.ok(standings.every((one) => !one.judged));
});
