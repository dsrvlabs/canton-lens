// **The answer a real participant gave, drawn.**
//
// Everything before this judged the API. An API that is right and a screen that drops half of it is the same
// failure to the person reading it, and nothing on the server side can see it. So here the backend is stood
// up over the recorded ledger, its answers are taken as they are, and each screen is handed one and rendered.
//
// Four questions, one per screen:
//   ⑥ is every row of the answer on the screen — asked by looking for **what each row says it is**, not by
//     counting <tr>: a header is a <tr> too, one update can be two rows, and `total` is legitimately not the
//     number of rows. A count would be green while the rows were wrong.
//   ⑦ is every value of a row on the screen — delete `<RoleChips>` and the roles have to vanish with it.
//   ⑧ when the screen shows fewer than there are, does it say so.
//   ⑨ when the read failed, does it say that — rather than drawing an empty list.
//
// This only renders. Clicking is out of scope and stays out: a static render never fires an effect, so
// "Older" loses the earlier page (Contracts.tsx) is a thing review catches and this does not.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

// **The two browser globals the address helpers read at import time.** `hashPath(hash = location.hash)`
// defaults its argument from the address bar, so merely importing a screen touches `location` — and every
// view here is handed its address explicitly, so the default is never the value used. A theme is read the
// same way. Nothing else about a browser is stood up: a view that needed more than this would not be the
// function of one answer it is meant to be.
globalThis.location = { hash: "#/", pathname: "/", href: "http://screens.test/" };
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.document = { documentElement: { dataset: { theme: "light" } } };

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(HERE, "../../backend/src");
const FIXTURES = join(BACKEND, "check/fixtures");

// ── The answers ─────────────────────────────────────────────────────────────────
// The same recording the backend's own check replays, asked through the same app. **Not hand-written
// examples**: a made-up response is a response shaped the way the person writing the screen imagined, which
// is exactly the thing in question.
const { buildApp } = await import(`${BACKEND}/live/build-app.mjs`);
const { _clearSchemaCache } = await import(`${BACKEND}/router.ts`);
const { parseTape, replaySend, fakeTokenFor } = await import(`${BACKEND}/check/ledger-tape.ts`);

const meta = JSON.parse(await readFile(join(FIXTURES, "meta.json"), "utf8"));
const entries = parseTape(await readFile(join(FIXTURES, "ledger.jsonl"), "utf8"));
const bytes = new Map();
for (const name of await readdir(join(FIXTURES, "packages"))) {
  if (name.endsWith(".bin")) bytes.set(name, await readFile(join(FIXTURES, "packages", name)));
}
const recordedAt = new Date(meta.recordedAt);
const asOf = encodeURIComponent(recordedAt.toISOString());
const HOLDING = encodeURIComponent(
  "#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding",
);
const TRANSFER = encodeURIComponent(
  "#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction",
);

_clearSchemaCache();
const app = buildApp({
  send: replaySend(entries, bytes),
  ledgerAuth: { mode: "caller-bearer" },
  now: () => recordedAt,
});
/** One address, as one of the recorded people. */
const answer = async (url, who = "alice") => {
  const response = await app.inject({
    method: "GET",
    url,
    headers: { authorization: `Bearer ${fakeTokenFor(who)}` },
  });
  assert.equal(response.statusCode, 200, `${url} answered ${response.statusCode}`);
  return JSON.parse(response.body);
};

// ── The screens ─────────────────────────────────────────────────────────────────
const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL("..", import.meta.url)),
  resolve: {
    alias: {
      "@canton-lens/design-system": fileURLToPath(
        new URL("../../../packages/design-system/src/index.ts", import.meta.url),
      ),
    },
  },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [
    {
      // **One thing the views still read from the session, and it is not data.** `PartyChip` colours a party
      // differently when it is one of mine — a decoration, decided from a list the session already holds, and
      // drawing it from the row would mean the server deciding the colour. It is stubbed with the real list
      // (filled below), so the chips are coloured the way they would be and nothing else is read.
      name: "screen-fixtures",
      enforce: "pre",
      resolveId(source) {
        if (source.endsWith("/SessionContext.tsx")) return "\0screen-session";
      },
      load(id) {
        if (id === "\0screen-session") {
          return "export const useSession = () => ({ myParties: globalThis.__screens.myParties });";
        }
      },
    },
  ],
});
test.after(() => Promise.all([server.close(), app.close()]));

const load = (path) => server.ssrLoadModule(path);
const draw = (component, props) => renderToStaticMarkup(createElement(component, props));

// **The screen's own shortening, imported rather than restated.** Restating it here would make this test
// agree with a copy: the question is whether the value reached the screen, and the screen decides how much of
// it to print. A first version wrote its own `short` with the wrong length and found nothing at all.
const { short, shortParty, trimZeros, ts } = await load("/src/format/format.ts");
/** What a contract id looks like on a list row — `ContractLink` cuts at ten (chips.tsx). */
const shortContract = (id) => short(id, 10);

globalThis.__screens = { myParties: [] };

/**
 * The markup split into the blocks a row is drawn as, so a value can be required **in its own row** rather
 * than anywhere on the page. Asked globally, a value that landed in the wrong row satisfies the test
 * (2026-09-18 codex) — and a list of rows is exactly where that goes wrong.
 */
const rowsOf = (html, open = "<tr") => html.split(open).slice(1);

/** The block that draws this row, found by something only that row says. */
function rowShowing(html, mark, open = "<tr") {
  const found = rowsOf(html, open).filter((row) => row.includes(escapeHtml(mark)));
  assert.equal(found.length, 1, `expected exactly one row showing ${mark}, found ${found.length}`);
  return found[0];
}

/**
 * Some one row carries all of these values **together**.
 *
 * For the rows that have no id on them — an offer is drawn as a direction, an amount and a counterparty —
 * there is nothing that names one row, so requiring a unique one would be requiring a column the screen does
 * not have. What is still worth requiring is that the values arrive in one another's company: globally, one
 * offer's expiry can stand in for another's.
 */
function someRowShows(html, wanted, what, open = "<tr") {
  const values = wanted.map((v) => escapeHtml(String(v ?? ""))).filter((v) => v !== "");
  const found = rowsOf(html, open).some((row) => values.every((v) => row.includes(v)));
  assert.ok(found, `${what} — no single row carries ${values.join(" · ")}`);
}

/** Everything in `wanted` has to be somewhere in the markup, and the first one missing is the message. */
function shows(html, wanted, what) {
  const missing = wanted
    .map((value) => String(value ?? ""))
    .filter((value) => value !== "" && !html.includes(escapeHtml(value)));
  assert.deepEqual(missing, [], `${what} — ${missing.length} of ${wanted.length} not on the screen`);
}
const escapeHtml = (value) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Which parties are mine, taken from the session answer the same way the running app takes it.
globalThis.__screens.myParties = (await answer("/api/session")).parties.map((p) => p.party);

// ── Contracts ───────────────────────────────────────────────────────────────────

test("contracts: every row the answer holds is drawn, with every value it carries", async () => {
  const { ContractsView } = await load("/src/pages/Contracts.tsx");
  const body = await answer("/api/contracts?pageSize=25");
  assert.ok(body.rows.length > 1, "the recording has no contracts to draw");
  const page = {
    rows: body.rows,
    cursor: body.nextCursor,
    total: body.total,
    matched: body.matched,
    offset: body.offset,
    filter: body.filter,
  };
  const html = draw(ContractsView, { page, error: null, hash: "#/contracts" });

  // ⑥ — one row at a time, by the thing that names it.
  shows(
    html,
    body.rows.map((r) => shortContract(r.contractId)),
    "a contract the answer holds is not on the screen",
  );
  // ⑦ — every value of a row, **inside that row's own markup**. The roles are the point: delete
  // <RoleChips> and this is what goes red. Asked of every row rather than one, so a value drawn in the
  // wrong place fails here too.
  for (const one of body.rows) {
    const row = rowShowing(html, shortContract(one.contractId));
    shows(
      row,
      [
        one.entity,
        one.module,
        one.packageName ?? short(one.package, 8),
        ts(one.createdAt),
        ...one.myRoles.flatMap((m) => [shortParty(m.party), m.roles.join("+")]),
      ],
      `the row for ${shortContract(one.contractId)} is missing one of its own values`,
    );
  }
  // ⑧ — the page is a selection and says which selection it is.
  assert.ok(body.rows.length < body.total, "the recording no longer overflows one page");
  shows(
    html,
    [`${body.rows.length} of ${body.matched} shown`, String(body.total)],
    "the screen shows fewer rows than there are and does not say so",
  );
});

test("contracts: a read that failed is said, not drawn as an empty list", async () => {
  const { ContractsView } = await load("/src/pages/Contracts.tsx");
  // ⑨ — the failure the backend hands up (phase 7 puts these in on purpose).
  const html = draw(ContractsView, {
    page: null,
    error: "node_error",
    hash: "#/contracts",
  });
  assert.match(html, /Could not fetch/);
  assert.ok(!html.includes("No active contracts are visible"), "a failure drawn as an empty list");
});

// ── Transactions ────────────────────────────────────────────────────────────────

test("transactions: every update the answer holds is drawn, with its events", async () => {
  const { TransactionsView } = await load("/src/pages/Transactions.tsx");
  const u = await answer("/api/updates");
  assert.ok(u.rows.length > 1, "the recording has no updates to draw");
  const html = draw(TransactionsView, { u, error: null, hash: "#/transactions" });

  shows(
    html,
    u.rows.map((r) => short(r.updateId, 8)),
    "an update the answer holds is not on the screen",
  );
  for (const one of u.rows) {
    const row = rowShowing(html, short(one.updateId, 8));
    shows(
      row,
      [
        ts(one.effectiveAt),
        String(one.offset),
        // The summary chips name the templates the update touched — the first two of them, and then how
        // many were left out. Half of a summary is worse than none: it reads as the whole of it.
        ...one.events
          .slice(0, 2)
          .map((e) => `${e.kind === "created" ? "created" : "archived"} ${e.entity}`),
        ...(one.events.length > 2 ? [`and ${one.events.length - 2} more`] : []),
      ],
      `the row for ${short(one.updateId, 8)} is missing one of its own values`,
    );
  }
});

test("transactions: a read that failed is said", async () => {
  const { TransactionsView } = await load("/src/pages/Transactions.tsx");
  const html = draw(TransactionsView, { u: null, error: "unreachable", hash: "#/transactions" });
  assert.match(html, /Could not fetch/);
});

// ── Holdings ────────────────────────────────────────────────────────────────────

test("holdings: every balance is drawn, and a balance that cannot be exact says so", async () => {
  const { HoldingsView } = await load("/src/pages/Holdings.tsx");
  const h = await answer(`/api/holdings?holdingInterfaceId=${HOLDING}`);
  assert.equal(h.kind, "available");
  assert.ok(h.view.groups.length > 1, "the recording has no balances to draw");
  const html = draw(HoldingsView, { h });

  // ⑦ — a balance is a sum **and how many contracts it is made of**: with only the number, there is no way
  // down to the contracts, which is the whole reason this screen carries the count (2026-09-18 codex).
  for (const g of h.view.groups) {
    someRowShows(
      html,
      [
        g.instrumentId,
        trimZeros(g.total),
        `made of ${g.contractCount} ${g.contractCount === 1 ? "contract" : "contracts"}`,
      ],
      `the balance of ${g.instrumentId} is not drawn as one row`,
    );
  }
  // **The decaying token is the one that matters here.** Its total is not an exact balance and the screen
  // has to say so **on that row** rather than somewhere on the page (phase 6 put one in the ledger for this).
  const decaying = h.view.groups.filter((g) => g.exactBalance === "unavailable_decay");
  assert.ok(
    decaying.length > 0,
    "the recording holds no decaying token — conditions.ts should have caught that",
  );
  for (const g of decaying) {
    someRowShows(
      html,
      [g.instrumentId, trimZeros(g.total), "exact balance unavailable"],
      `the decaying balance of ${g.instrumentId} is drawn as though it were exact`,
    );
  }
  // An exact one must not carry that sentence — otherwise the words above prove nothing.
  for (const g of h.view.groups.filter((one) => one.exactBalance === "face_value")) {
    const row = rowsOf(html).find(
      (r) => r.includes(escapeHtml(g.instrumentId)) && r.includes(escapeHtml(trimZeros(g.total))),
    );
    assert.ok(row !== undefined, `no row draws ${g.instrumentId}`);
    assert.ok(
      !row.includes("exact balance unavailable"),
      `${g.instrumentId} is exact and is drawn as though it were not`,
    );
  }
  // And a contract whose standard view could not be computed is a problem the screen states, with the count.
  assert.ok(h.view.problems.length > 0, "the recording holds no unreadable view");
  shows(
    html,
    [`${h.view.problems.length} Holding contracts had an unexpected shape`],
    "a holding that could not be read is silent",
  );
});

test("holdings: a read that failed is said", async () => {
  const { HoldingsView } = await load("/src/pages/Holdings.tsx");
  const html = draw(HoldingsView, { h: { kind: "unavailable", reason: "node_error", readAt: "", offset: 0 } });
  assert.match(html, /Could not fetch/);
});

// ── Preapprovals ────────────────────────────────────────────────────────────────

test("preapprovals: every row is drawn, and an expired one is not drawn as live", async () => {
  const { PreapprovalsView } = await load("/src/pages/Preapprovals.tsx");
  const p = await answer(`/api/preapprovals?asOf=${asOf}`);
  assert.equal(p.kind, "available");
  const rows = p.view.rows;
  assert.ok(rows.length > 1, "the recording has no preapprovals to draw");
  const html = draw(PreapprovalsView, { p });

  // ⑦ — each row by its own contract, with the three values beside it. Asked globally, one row's issuer
  // could stand in for another's (2026-09-18 codex).
  for (const r of rows) {
    const row = rowShowing(html, short(r.contractId, 6));
    shows(
      row,
      [
        r.instrumentId,
        shortParty(r.receiver),
        shortParty(r.issuer),
        r.expiry.passed
          ? `Expired (${Math.round(r.expiry.passedByMs / 60000)}m ago)`
          : `${Math.round((r.expiry.remainingMs ?? 0) / 60000)}m left`,
      ],
      `the preapproval ${short(r.contractId, 6)} is missing one of its own values`,
    );
  }
  // Phase 6 put an expired one beside a live one for the same receiver. The screen must tell them apart.
  assert.ok(
    rows.some((r) => r.expiry.passed) && rows.some((r) => !r.expiry.passed),
    "the recording holds no expired preapproval beside a live one",
  );
  assert.match(html, /Expired/, "an expired preapproval is not marked expired");
  assert.match(html, /left/, "a live preapproval does not say how long it has");
});

// ── Offers ──────────────────────────────────────────────────────────────────────

test("offers: every offer is drawn with its direction and its counterparty", async () => {
  const { OffersView } = await load("/src/pages/Offers.tsx");
  const o = await answer(`/api/offers?interfaceId=${TRANSFER}&asOf=${asOf}`);
  assert.equal(o.kind, "available");
  const rows = o.view.rows;
  assert.ok(rows.length > 1, "the recording has no offers to draw");
  const html = draw(OffersView, { o });
  // **The counterparty, not both sides.** An offer row says which way it goes and who the *other* party is;
  // printing my own party in a column headed "counterparty" would be the screen inventing a fact. So what is
  // required here is what the row claims to say, read off the direction the server judged.
  //
  // ⑦ — and the amount and the time left, in the row's own markup. Without them a row is a direction and a
  // name, which is not what an offer is (2026-09-18 codex).
  for (const r of rows) {
    const other = shortParty(r.directionInfo?.direction === "received" ? r.sender : r.receiver);
    someRowShows(
      html,
      [
        trimZeros(r.amount),
        r.instrumentId,
        other,
        r.expiry.passed
          ? `Expired (${Math.round(r.expiry.passedByMs / 60000)}m ago)`
          : `${Math.round((r.expiry.remainingMs ?? 0) / 60000)}m left`,
      ],
      `the offer of ${trimZeros(r.amount)} ${r.instrumentId} is not drawn as one row`,
    );
  }
  // Both directions are in the recording, so both blocks are drawn rather than one being permanently empty.
  assert.ok(
    rows.some((r) => r.directionInfo?.direction === "received") &&
      rows.some((r) => r.directionInfo?.direction === "sent"),
    "the recording holds offers in one direction only",
  );
  shows(html, ["Received", "Sent"], "an offer's direction is not on the screen");
});

// ── Home ────────────────────────────────────────────────────────────────────────

test("home: the cards say what the answer says, and a truncated list says it is one", async () => {
  const { HomeView } = await load("/src/pages/Home.tsx");
  const h = await answer(`/api/home?asOf=${asOf}&holdingInterfaceId=${HOLDING}&interfaceId=${TRANSFER}`);
  const html = draw(HomeView, { h });
  assert.equal(h.recent.status, "ok");

  // ⑦ — **the cards say the numbers the answer gave.** The test was named for this and did not ask it
  // (2026-09-18 codex). Each is read from the answer, so a card that stopped being drawn goes red.
  if (h.cards.activeContracts.status === "ok") {
    shows(html, [String(h.cards.activeContracts.count)], "the active-contracts card has no count");
  }
  if (h.cards.pendingOffers.status === "ok") {
    shows(html, [String(h.cards.pendingOffers.pending)], "the pending-offers card has no count");
  }
  if (h.cards.tokens.status === "ok") {
    shows(html, [String(h.cards.tokens.kinds), ...h.cards.tokens.labels], "the tokens card is bare");
  }
  shows(html, [String(h.viewer.partyCount)], "home does not say how many parties are mine");

  // **Home's list is a selection on purpose** — the latest few, with the rest on the Transactions screen.
  // So what is required is not "every row" but that the screen's own claim about the cut is true. It is read
  // off the screen rather than assumed: the number it draws is the card's business and may change.
  const claim = html.match(/latest (\d+) of (\d+)/);
  assert.ok(claim, "home draws fewer updates than the window holds and does not say so");
  const [, drawnText, totalText] = claim;
  const drawn = Number(drawnText);
  assert.equal(
    Number(totalText),
    h.recent.totalInWindow,
    "home's stated total is not the window's",
  );
  // ⑥ — the rows it says it drew are there, and they are the newest ones rather than any six.
  shows(
    html,
    h.recent.rows.slice(0, drawn).map((r) => short(r.updateId, 8)),
    "a recent update home says it drew is not on the screen",
  );
  // ⑧ — and the branch is reachable at all. Phase 6 made the window hold more than the card draws.
  assert.ok(
    drawn < h.recent.totalInWindow,
    "home's recent list is no longer a selection — conditions.ts should have caught that",
  );
});

// ── Parties ─────────────────────────────────────────────────────────────────────

test("parties: every party of mine is drawn with the rights it carries", async () => {
  const { PartiesView } = await load("/src/pages/Parties.tsx");
  const session = await answer("/api/session");
  assert.equal(session.outcome, "view");
  const html = draw(PartiesView, { session, loading: false });
  // ⑦ — **the capacities too.** A list of party names with the rights column removed is a different
  // statement: "these are yours" rather than "these are yours, and this is how" (2026-09-18 codex).
  for (const p of session.parties) {
    const row = rowShowing(html, shortParty(p.party));
    shows(row, p.kinds, `the row for ${shortParty(p.party)} does not say what it may do`);
  }
  // The seed holds one party carrying both capacities and one person holding two parties — the two shapes
  // a list of names alone cannot tell apart.
  assert.ok(
    session.parties.some((p) => p.kinds.length > 1) || session.parties.length > 1,
    "this person has neither two parties nor a party with two capacities",
  );
});

// ── Timeline ────────────────────────────────────────────────────────────────────

test("timeline: every lifetime is drawn, and one that ends unseen is not drawn as alive", async () => {
  const { TimelineView } = await load("/src/pages/Timeline.tsx");
  const data = await answer("/api/timeline?from=1");
  assert.ok(data.groups.length > 0, "the recording has no lifetimes to draw");
  const html = draw(TimelineView, { data, error: null, hash: "#/timeline?from=1" });
  shows(
    html,
    data.groups.map((g) => g.entity),
    "a template the timeline holds is not on the screen",
  );
  // ⑥ — **every bar, not just the group headings.** Checking only the headings left the chart's rows free to
  // disappear entirely with the test still green (2026-09-18 codex).
  const lines = data.groups.flatMap((g) => g.lines);
  assert.ok(lines.length > data.groups.length, "there is no group with more than one bar to lose");
  shows(
    html,
    lines.map((l) => short(l.contractId, 8)),
    "a lifetime the answer holds is not drawn",
  );
  // ⑦ — and each bar says whose it is and how it ended, in its own row. The state is a class on the bar,
  // which is what the three legends underneath refer to.
  for (const line of lines) {
    const row = rowShowing(html, short(line.contractId, 8), '<div class="tl__row"');
    assert.match(
      row,
      new RegExp(`tl__bar--${line.state}\\b`),
      `the bar for ${short(line.contractId, 8)} does not say it is ${line.state}`,
    );
    // A contract seen only as an archive carries no parties, and the screen says that rather than nothing.
    if (line.parties.length > 0) shows(row, [shortParty(line.parties[0])], "a bar names nobody");
  }
  // Phase 6 put a contract that was created and archived inside one window into the recording, so the
  // archived state is drawn at all.
  assert.ok(
    lines.some((l) => l.state === "archived"),
    "the recording holds no archived lifetime",
  );
  assert.match(html, /tl__bar--archived/, "no bar is drawn as archived");
});
