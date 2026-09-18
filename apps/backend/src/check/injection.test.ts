// **Every address, every read it makes, broken one at a time.**
//
// The recording holds what the node *did* answer, so no amount of re-recording reaches the failure this
// product is most likely to have and least likely to notice: a read that fell over, served as an empty list.
// Here the failures are put in on purpose and the answer has to say so.
//
// The matrix is derived, not listed: the addresses come from the check table and the reads from what each
// address actually asked the node when it was healthy. So an address that starts making a new kind of call
// is covered the day it does, and the count moving is a fact about the product rather than about this file.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildApp } from "../live/build-app.mjs";
import { _clearSchemaCache } from "../router.ts";
import { type Harvest, harvest, ROUND_ONE, ROUND_TWO } from "./expectations.ts";
import type { Given } from "./given.ts";
import {
  type Answer,
  type Give,
  howItTookTheFailure,
  injectingSend,
  statusWords,
} from "./injection.ts";
import { fakeTokenFor, parseTape, replaySend } from "./ledger-tape.ts";
import { nowFrom } from "./run-check.ts";
import { tracingSend } from "./trace.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");

const meta = JSON.parse(await readFile(join(FIXTURES, "meta.json"), "utf8")) as {
  recordedAt: string;
  people: (Given & { name: string })[];
};
const entries = parseTape(await readFile(join(FIXTURES, "ledger.jsonl"), "utf8"));
const bytes = new Map<string, Uint8Array>();
for (const name of await readdir(join(FIXTURES, "packages"))) {
  if (name.endsWith(".bin")) bytes.set(name, await readFile(join(FIXTURES, "packages", name)));
}
const recordedAt = new Date(meta.recordedAt);

/**
 * **Asked as one fully provisioned person.** The failure paths do not branch on who is asking — a read that
 * fell over fell over for everybody — and the people who differ are covered by every other level. What this
 * person buys is that every address has something to read in the first place.
 */
const WHO = "alice";

/** One run of one address, with an optional read broken. */
async function ask(
  url: string,
  injection?: { path: string; give: Give },
): Promise<{ answer: Answer; paths: string[]; hits: number }> {
  _clearSchemaCache();
  const tape = replaySend(entries, bytes);
  const injector =
    injection === undefined
      ? null
      : injectingSend(tape, { when: { path: injection.path }, give: injection.give });
  const tracer = tracingSend(injector?.send ?? tape);
  const app = buildApp({
    send: tracer.send,
    ledgerAuth: { mode: "caller-bearer" },
    now: () => recordedAt,
  });
  const response = await app.inject({
    method: "GET",
    url,
    headers: { authorization: `Bearer ${fakeTokenFor(WHO)}` },
  });
  await app.close();
  let body: unknown = null;
  try {
    body = response.body === "" ? null : JSON.parse(response.body);
  } catch {
    body = null;
  }
  return {
    answer: { status: response.statusCode, body },
    paths: tracer.take().map((call) => call.path),
    hits: injector?.hits() ?? 0,
  };
}

/**
 * The reads one address makes, one entry per **kind** of read rather than per call. The catalogue downloads
 * thirty-two packages; breaking the first is the claim, and breaking the other thirty-one is the same claim
 * thirty-one more times.
 */
const kindsOfRead = (paths: readonly string[]): string[] => {
  const seen = new Set<string>();
  for (const path of paths) seen.add(path.split("?")[0] ?? path);
  return [...seen];
};

/** Every address the check knows, with the values round two needs already substituted in. */
async function everyAddress(): Promise<{ label: string; url: string }[]> {
  const now = nowFrom(recordedAt);
  const bodies = new Map<string, unknown>();
  const out: { label: string; url: string }[] = [];
  for (const spec of ROUND_ONE) {
    const url = spec.url({} as Harvest, now);
    if (url === null) continue;
    out.push({ label: spec.name ?? spec.template, url });
    bodies.set(url, (await ask(url)).answer.body);
  }
  const harvested = harvest(bodies);
  for (const spec of ROUND_TWO) {
    const url = spec.url(harvested, now);
    if (url !== null) out.push({ label: spec.name ?? spec.template, url });
  }
  return out;
}

test("every read of every address, broken one at a time, is answered by saying so", async () => {
  const addresses = await everyAddress();
  assert.equal(addresses.length, 19, "the check table changed shape");

  const findings: string[] = [];
  let broken = 0;
  for (const { label, url } of addresses) {
    const healthy = await ask(url);
    assert.equal(healthy.answer.status, 200, `${label} does not answer 200 when nothing is broken`);
    assert.ok(healthy.paths.length > 0, `${label} asked the node nothing`);
    for (const path of kindsOfRead(healthy.paths)) {
      const injured = await ask(url, { path, give: "500" });
      broken += 1;
      if (injured.hits === 0) {
        findings.push(
          `${label} · ${path} — the failure was never delivered, so this proved nothing`,
        );
        continue;
      }
      const wrong = howItTookTheFailure(healthy.answer, injured.answer);
      if (wrong !== null) findings.push(`${label} · ${path} — ${wrong}`);
    }
  }
  assert.deepEqual(findings, [], `\n${findings.join("\n")}`);
  // Derived from what the addresses actually read — it moves when the product's reads move, and that is the
  // only thing that should move it.
  assert.ok(broken >= 40, `only ${broken} reads were broken — the matrix collapsed`);
});

test("the four failures that really happen, on the address that makes the longest read", async () => {
  // **One address, spelled out.** The sweep above asks the same question of everything; this one says what
  // each kind of failure *is* — they are four different circumstances and this product answers them with
  // four different things, which is the part a reviewer should be able to read off a page.
  const url = "/api/contracts";
  const acs = "/v2/state/active-contracts";
  const said = async (give: Give) => {
    const { answer, hits } = await ask(url, { path: acs, give });
    assert.ok(hits > 0, `${give} was never delivered`);
    const reason = (answer.body as { reason?: unknown } | null)?.reason;
    return `${answer.status} ${String(reason)}`;
  };

  assert.equal(await said("500"), "502 node_error", "the node answered badly");
  assert.equal(await said("down"), "504 unreachable", "the connection never opened");
  // Named by the node, not guessed from the status: the operator's lever is the participant's
  // `http-list-max-elements-limit`, and only the name says so.
  assert.equal(await said("413"), "502 too_many_elements", "the node refused the length");
  // A walk that never ends is stopped by this application, and what it must never do is serve the part it
  // collected as though it were the whole list.
  assert.equal(await said("endless"), "502 too_many_elements", "the walk ran out of budget");
});

test("the failures Canton reports by name reach the statuses they were given", async () => {
  // **The branches a recording cannot walk.** These arrive as a *name* inside the body — the status alone
  // does not say which — so the tape can never hold one (every recorded question was answered) and neither
  // can an invented status. They are also the branches where getting it wrong is quietest: a past the
  // participant has pruned reported as "no such thing", or a refusal reported as a server fault.
  const said = async (url: string, path: string, give: Give) => {
    const { answer, hits } = await ask(url, { path, give });
    assert.ok(hits > 0, `${give} was never delivered to ${path}`);
    return `${answer.status} ${String((answer.body as { reason?: unknown } | null)?.reason)}`;
  };
  const acs = "/v2/state/active-contracts";

  assert.equal(await said("/api/contracts", acs, "401"), "401 unauthenticated");
  // A refusal is the caller's own token being told no — not this server failing.
  assert.equal(await said("/api/contracts", acs, "403"), "403 forbidden");
  // It existed and is no longer kept: 410 Gone, which is neither "never was" nor "server broke".
  assert.equal(await said("/api/contracts", acs, "pruned"), "410 pruned");

  const byOffset = "/v2/updates/update-by-offset";
  const offsetUrl = (await everyAddress()).find((a) =>
    a.label.startsWith("/api/updates/by-offset"),
  )?.url;
  assert.ok(offsetUrl !== undefined, "the check no longer asks by offset");
  assert.equal(await said(offsetUrl, byOffset, "not_found"), "404 not_found");
  // Well-formed, and a point that has not happened yet — the caller can wait, so it is theirs to fix (400).
  assert.equal(await said(offsetUrl, byOffset, "after_the_end"), "400 offset_after_ledger_end");
});

test("one blueprint that could not be read is a row that says so, and a catalogue that stands", async () => {
  // **What the sweep cannot ask.** It asks whether the answer said anything about the failure at all — the
  // coarse question, and the right one to ask of nineteen addresses at once. It cannot ask whether the answer
  // said the *right* thing, and there is room to be wrong in between: a row can report the failure in one
  // field and claim success in another. Here that is spelled out for the one address where a failure is
  // meant to stay inside a row rather than take the whole answer down.
  const healthy = await ask("/api/catalog/packages");
  const rows = (body: unknown) =>
    ((body as { rows?: Record<string, unknown>[] }).rows ?? []) as Record<string, unknown>[];
  const first = rows(healthy.answer.body)[0];
  assert.ok(first !== undefined, "the catalogue is empty");
  assert.equal(
    first.schemaStatus,
    "ok",
    "the first package's blueprint does not read when healthy",
  );

  const packageId = String(first.packageId);
  const injured = await ask("/api/catalog/packages", {
    path: `/v2/packages/${packageId}`,
    give: "500",
  });
  assert.equal(
    injured.answer.status,
    200,
    "one unreadable blueprint took the whole catalogue down",
  );
  const row = rows(injured.answer.body).find((r) => r.packageId === packageId);
  assert.ok(
    row !== undefined,
    "the row disappeared — a package the node has, missing from its own catalogue",
  );
  // **The node's own reason, not a word of ours.** `ok` with an empty template list would read as "read it,
  // there was nothing in it", which is the thing that must never be said about a read that did not happen.
  assert.equal(row.schemaStatus, "node_error");
  assert.deepEqual(row.templates, []);
  assert.deepEqual(row.interfaces, []);

  // And the rest of the catalogue is exactly what it was. One blueprint this node cannot hand over does not
  // make the other thirty-one untrue.
  assert.equal(rows(injured.answer.body).length, rows(healthy.answer.body).length);
  const others = (body: unknown) =>
    rows(body)
      .filter((r) => r.packageId !== packageId)
      .map((r) => JSON.stringify(r));
  assert.deepEqual(others(injured.answer.body), others(healthy.answer.body));
});

test("a short list served as a whole one is what this exists to catch", async () => {
  // The failure mode itself, stated as a test rather than trusted to the sweep: an answer that swallows the
  // failure is a 200 whose body says nothing, and `howItTookTheFailure` has to call that a finding. Without
  // this, a marker-finder that matched anything at all would make the sweep green while looking at nothing.
  const healthy: Answer = { status: 200, body: { rows: [1, 2, 3], total: 3 } };
  assert.equal(
    howItTookTheFailure(healthy, { status: 200, body: { rows: [], total: 0 } }),
    "answered 200 and said nothing about the read that failed",
  );
  assert.equal(
    howItTookTheFailure(healthy, healthy),
    "the answer did not change at all — this read was made and then not used",
  );
  assert.equal(howItTookTheFailure(healthy, { status: 502, body: { reason: "node_error" } }), null);
  assert.equal(
    howItTookTheFailure(healthy, { status: 502, body: {} }),
    "answered 502 with no reason — a failure has to be named to be acted on",
  );
  // And a 200 that names the part that went dark is a good answer, not a finding.
  assert.equal(
    howItTookTheFailure(healthy, {
      status: 200,
      body: { rows: [1, 2, 3], schema: { status: "unavailable" } },
    }),
    null,
  );
  assert.deepEqual(statusWords({ a: { status: "unavailable", reason: "x" } }), [
    "reason=x",
    "status=unavailable",
  ]);
});
