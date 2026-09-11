#!/usr/bin/env node
// **The only code in the repository that actually attaches to a ledger.**
//
// Runs the four screens of `packages/core` against live participant responses and prints the values.
// Every verification before this point was done without a ledger, and this file is the first to show
// that it and the real ledger agree.
//
//   LEDGER_BASE=http://localhost:7575 LEDGER_TOKEN=… node apps/backend/src/live/show-screens.mjs   (WHO=bob switches the user)
//
// This file does only two things: `fetch` with a token, and print the answers to the screen.
// **Neither what to ask nor how, nor what counts as failure, is decided here** — paths and bodies are
// built by the `ledger-request` layer, and non-200 answers are split into five by that layer. So this
// file has only `send` left in it.
import {
  callGetAuthenticatedUser,
  callListUserRights,
  callGetLedgerEnd,
  callGetActiveContracts,
  buildViewerParties,
  buildContractList,
  buildContractDetail,
  buildTransferOffers,
} from "@canton-lens/core";

// No defaults — the caller supplies the ledger URL and the user token.
// LEDGER_TOKEN must be a user token — with admin, the boundary Canton cuts is invisible.
const missing = [];
const need = (name) => process.env[name] || (missing.push(name), undefined);
const BASE = need("LEDGER_BASE");
const TOKEN = need("LEDGER_TOKEN");
// Optional — if absent, the interface view is skipped.
const INTERFACE_ID = process.env.LEDGER_INTERFACE ?? null;

if (missing.length > 0) {
  console.error(
    `[screens] aborted — ${missing.join(", ")} is missing.\n` +
      "  LEDGER_TOKEN=… LEDGER_BASE=… node apps/backend/src/live/show-screens.mjs",
  );
  process.exit(2);
}

// ── The only place that touches the network ──────────────────────────────────
// If unreachable, it throws. Naming that `unreachable` is the layer's job, not this file's —
// "could not reach" and "reached but was refused" must say different things on screen.
async function send(request) {
  const response = await fetch(`${BASE}${request.path}`, {
    method: request.method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(request.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  });
  const text = await response.text();
  // Does not throw, for the same reason as serve.mjs — failing to read the body is not “could not reach”.
  if (!text) return { status: response.status, body: null };
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: null };
  }
}

// Only puts the five reasons the layer split into human words. No status numbers exist in this file.
const SAID = {
  unauthenticated: "the token is missing or expired",
  forbidden: "outside this person's permissions",
  not_found: "no such path or target",
  node_error: "the node refused",
  unreachable: "could not reach the node",
};

function must(label, result) {
  if (result.ok) return result.value;
  console.error(`\n✗ ${label} — ${SAID[result.reason]}${result.detail ? ` (${result.detail})` : ""}`);
  process.exit(1);
}

const heading = (text) => console.log(`\n\x1b[1m${text}\x1b[0m`);
const rows = (value) => (Array.isArray(value) ? value : (value?.result ?? []));
const events = (value) => rows(value).map((row) => row.contractEntry.JsActiveContract.createdEvent);

// ── 1. My parties and rights ─────────────────────────────────────────────────
const me = must("who am I", await callGetAuthenticatedUser(send));
const rights = must("my rights", await callListUserRights(send, me.user.id));

const viewer = buildViewerParties(me, rights);
if (viewer.outcome !== "view") {
  console.error("could not compute my parties:", viewer.reason);
  process.exit(1);
}

heading("My parties and rights");
console.log(`  user     ${viewer.userId}`);
console.log(`  scope    ${viewer.scope === "own" ? "my scope" : "entire instance ← a badge is shown"}`);
for (const entry of viewer.parties) console.log(`  party    ${entry.party}  [${entry.kinds.join(", ")}]`);
if (viewer.parties.length === 0) console.log("  party    none — there is nothing to see");

const parties = viewer.parties.map((entry) => entry.party);

// ── 2. Contract list ─────────────────────────────────────────────────────────
// Take the offset first and receive the snapshot as of that point. A Live-mode answer is always for a
// specific offset, and if that value is not on screen the user cannot tell when it is from.
const end = must("current offset", await callGetLedgerEnd(send));
const acs = must("active contracts", await callGetActiveContracts(send, parties, end.offset));

const entries = events(acs);
const list = buildContractList(entries, parties[0] ?? "", { pageSize: 5 });
if (!list.ok) {
  console.error("could not build the contract list:", list.reason);
  process.exit(1);
}

heading(`Contract list — as of offset ${end.offset}`);
for (const row of list.page.rows) {
  console.log(`  ${row.entity.padEnd(14)} ${row.createdAt.slice(0, 19)}  counterparties ${row.counterpartyParty.length}`);
}
console.log(
  list.page.nextCursor
    ? `  … next page available (cursor ${list.page.nextCursor.contractId.slice(0, 12)}…)`
    : `  ${list.page.rows.length} in total`,
);

// ── 3. Contract detail ───────────────────────────────────────────────────────
if (entries.length > 0) {
  const detail = buildContractDetail(entries[0]);
  heading("Contract detail — first item of the list");
  if (!detail.ok) console.log(`  could not build: ${detail.reason}`);
  else {
    const view = detail.view;
    console.log(`  ${view.packageName} : ${view.module} : ${view.entity}`);
    console.log(`  signatories ${view.signatories.length}   observers ${view.observers.length}`);
    console.log(`  created  ${view.createdAt}`);
    console.log(`  render   ${view.renderMode}`);
    console.log(`  choices  ${view.choices.kind}   ← structurally absent from the layer 1 response`);
  }
}

// ── 4. Received offers ───────────────────────────────────────────────────────
// The view only comes if the interface is named. Without naming it, interfaceViews in the response is always empty.
// The `#packagename:…` used to name it and the `packagehash:…` the response gives differ in spelling —
// bridging those two is also the layer's job, so here the given value is passed through as is.
heading("Received offers");
if (!INTERFACE_ID) {
  console.log("  LEDGER_INTERFACE is missing — without naming an interface, no view comes");
} else {
  const viewed = must(
    "active contracts queried by interface",
    await callGetActiveContracts(send, parties, end.offset, INTERFACE_ID),
  );
  const offers = buildTransferOffers(events(viewed), INTERFACE_ID, new Date());
  if (offers.kind !== "available") console.log(`  could not fetch: ${offers.reason}`);
  else if (offers.view.rows.length === 0) console.log("  no contracts visible through this interface");
  else
    for (const row of offers.view.rows) {
      const left = row.expiry.passed
        ? `expired (${Math.round(row.expiry.passedByMs / 60000)} min ago)`
        : `${Math.round(row.expiry.remainingMs / 60000)} min left`;
      const mine = parties.includes(row.receiver) ? "received" : parties.includes(row.sender) ? "sent" : "third party";
      console.log(`  ${mine}  ${row.amount} ${row.instrumentId}  ${left}`);
    }
  if (offers.kind === "available" && offers.view.problems.length > 0)
    console.log(`  ${offers.view.problems.length} view errors — errors, not values`);
}

console.log();
