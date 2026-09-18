// **GET /api/holdings, written out again by hand.**
//
// A Canton balance is not a number in an account — it is the sum of several Holding contracts, the way a
// UTXO balance is. So this answer groups my visible holdings by (instrument, owner), sums them, and keeps
// the contracts the sum is made of so the screen can drill down instead of asking again.
//
// **It asks the node through the standard Holding interface**, not by template name: a token is a thing that
// implements the standard, and the node attaches its own view of it. So the trace for this path holds an
// *interface-filtered* active-contracts question, which is a different question from the unnarrowed one and
// is picked out by the id that was asked for.
//
// Written by reading router.ts, envelope.ts (`toRawCreatedEvents`) and
// core/token-holdings/build-token-holdings.ts.
import {
  app,
  type Branches,
  buildObject,
  type CheckContext,
  type Expectation,
  type Mapping,
  node,
  type Rule,
} from "../mapping.ts";
import { acsPagesForInterface, arr, fqn, ledgerEnd, myParties, rec, str } from "./read-trace.ts";

// **Tokens whose balance decays each round.** Layer 1 carries nothing that says so, so the product keeps one
// list and this states the same one. Splice CC is the case: an exact balance is not available, and neither a
// zero nor a face-value sum presented as exact would be true.
// **The tape does not hold one.** Replacing the product's decay judgment with a constant changes nothing in
// the recorded answers: the seeded stack issues no Splice.Amulet. The sentence stays as written, and
// "somebody holds a decaying token" goes on the list of data conditions the seed still owes.
const DECAYING = [
  { module: "Splice.Amulet", entity: "Amulet" },
  { module: "Splice.Amulet", entity: "LockedAmulet" },
];

// ── Decimal arithmetic, done the way a balance has to be done ────────────────────
// Not floating point: `0.1 + 0.2` in a balance is a wrong number on a screen about money. Whole units and a
// scale, added as integers, and the result keeps the longer of the two scales — digits are never invented.
type Decimal = { units: bigint; scale: number };

const readDecimal = (raw: string): Decimal | null => {
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return null;
  const negative = raw.startsWith("-");
  const [whole = "0", frac = ""] = (negative ? raw.slice(1) : raw).split(".");
  return { units: BigInt(whole + frac) * (negative ? -1n : 1n), scale: frac.length };
};

const addDecimals = (a: Decimal, b: Decimal): Decimal => {
  const scale = Math.max(a.scale, b.scale);
  return {
    units: a.units * 10n ** BigInt(scale - a.scale) + b.units * 10n ** BigInt(scale - b.scale),
    scale,
  };
};

const writeDecimal = ({ units, scale }: Decimal): string => {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale) || "0";
  return `${negative ? "-" : ""}${whole}${scale > 0 ? `.${digits.slice(digits.length - scale)}` : ""}`;
};

// ── One contract of a balance ────────────────────────────────────────────────────

type Holding = { contractId: string; amount: string; issuer: string };

const HOLDING_CONTRACT: Record<string, Rule<Holding>> = {
  contractId: node("contractId"),
  amount: app("the view's amount, as the text the node sent — never re-formatted", (h) => h.amount),
  issuer: app(
    "the instrument's admin — the registry that issues it — or the empty string when the instrument names none",
    (h) => h.issuer,
  ),
};

// ── One group ────────────────────────────────────────────────────────────────────

type Group = {
  instrumentId: string;
  instrumentAdmin: string | null;
  owner: string;
  decaying: boolean;
  sum: Decimal;
  contracts: Holding[];
  mine: string[];
};

const HOLDING_GROUP: Record<string, Rule<Group>> = {
  instrumentId: app(
    "the instrument's id: the view's instrumentId when it is text, or the id inside it when it is a record",
    (g) => g.instrumentId,
  ),
  instrumentAdmin: app(
    "the admin inside the instrument record, or null when the instrument is plain text and names none",
    (g) => g.instrumentAdmin,
  ),
  owner: app("the view's owner", (g) => g.owner),
  ownerIsViewer: app(
    "whether that owner is one of my own parties — the server settles it so the screen does not compare against my party list a second time",
    (g) => g.mine.includes(g.owner),
  ),
  exactBalance: app(
    "unavailable_decay when any contract in this group is a decaying token, face_value otherwise — a decaying balance is stated as not exact rather than drawn as a number that is not true",
    (g) => (g.decaying ? "unavailable_decay" : "face_value"),
  ),
  total: app(
    "the sum of the amounts, added as integers after lining up their scales, written back at the longer scale",
    (g) => writeDecimal(g.sum),
  ),
  contractCount: app("how many contracts the sum is made of", (g) => g.contracts.length),
  contracts: app("those contracts, in the order the node sent them", (g) =>
    g.contracts.map((contract) => buildObject(HOLDING_CONTRACT, contract)),
  ),
};

const PROBLEM: Record<string, Rule<{ contractId: string; message: string }>> = {
  contractId: node("contractId"),
  message: app(
    "what was wrong with that one contract — a Holding whose shape differs is left out of the total and said out loud, because a short total with a warning is true and a wrong total is not",
    (p) => p.message,
  ),
};

const VIEW: Record<
  string,
  Rule<{ groups: Group[]; problems: { contractId: string; message: string }[] }>
> = {
  groups: app(
    "one group per instrument and owner, mine on top, then by owner and instrument — arrangement, not judgment",
    (v) => v.groups.map((group) => buildObject(HOLDING_GROUP, group)),
  ),
  problems: app("one entry per contract that could not be read", (v) =>
    v.problems.map((problem) => buildObject(PROBLEM, problem)),
  ),
};

type Answer = {
  ctx: CheckContext;
  end: number;
  groups: Group[];
  problems: { contractId: string; message: string }[];
};

const AVAILABLE: Record<string, Rule<Answer>> = {
  kind: app("available — every entry the node sent was a shape this could read", () => "available"),
  view: app("the groups and the problems", (a) => buildObject(VIEW, a)),
  offset: app("the offset the contracts were read at", (a) => a.end),
  readAt: app("the instant the check handed the server as its clock", (a) => a.ctx.now.iso),
};

const UNAVAILABLE: Record<string, Rule<{ ctx: CheckContext; end: number; reason: string }>> = {
  kind: app(
    "unavailable — one entry was a shape this could not read at all, and a balance built from the rest would be a wrong number",
    () => "unavailable",
  ),
  reason: app("which shape, in this application's own words", (u) => u.reason),
  offset: app("the offset the contracts were read at", (u) => u.end),
  readAt: app("the instant the check handed the server as its clock", (u) => u.ctx.now.iso),
};

const HOLDINGS_RESPONSE: Branches = {
  by: "kind",
  of: [
    { when: ["available"], slots: AVAILABLE },
    { when: ["unavailable"], slots: UNAVAILABLE },
  ],
};

/** Two ids name one interface when module and entity agree and either side is written as a name. */
const sameInterface = (a: string, b: string): boolean => {
  const x = a.split(":");
  const y = b.split(":");
  if (x.length !== 3 || y.length !== 3) return false;
  if (x[1] !== y[1] || x[2] !== y[2]) return false;
  return x[0]?.startsWith("#") || y[0]?.startsWith("#") ? true : x[0] === y[0];
};

export const holdingsMapping: Mapping<CheckContext> = {
  root: "HoldingsResponse",
  slots: {
    HoldingsResponse: HOLDINGS_RESPONSE,
    TokenHoldingsView: VIEW,
    TokenHoldingGroup: HOLDING_GROUP,
    TokenHoldingContract: HOLDING_CONTRACT,
    TokenHoldingProblem: PROBLEM,
  },
  expected: (ctx): Expectation => {
    const end = ledgerEnd(ctx.trace);
    if (end === null) return { ok: false, why: "the trace holds no ledger end" };
    const asked = new URL(ctx.url, "http://check").searchParams.get("holdingInterfaceId");
    if (asked === null) {
      // Without the standard interface the product falls back to one hard-coded template. The check does not
      // ask that way, and a rule nobody exercises is a rule nobody has checked.
      return { ok: false, why: "these rules do not describe the template fallback yet" };
    }
    const pages = acsPagesForInterface(ctx.trace, asked);
    if (pages.length === 0) {
      return { ok: false, why: `the trace holds no active-contracts call through ${asked}` };
    }

    const mine = myParties(ctx.trace);
    const sums = new Map<string, Group>();
    const problems: { contractId: string; message: string }[] = [];
    for (const page of pages) {
      for (const item of arr(page.answer)) {
        const event = rec(rec(rec(rec(item).contractEntry).JsActiveContract).createdEvent);
        const contractId = str(event.contractId);
        const parts = fqn(event.templateId);
        if (contractId === null || parts === null || str(event.packageName) === null) {
          return { ok: false, why: "an active-contracts entry is not the shape these rules read" };
        }
        // **A contract with no view of this interface is not a token at all** — an app's own token that does
        // not implement the standard is out of scope here, and that is not a failure.
        const view = arr(event.interfaceViews).find((v) => {
          const id = str(rec(v).interfaceId);
          return id !== null && sameInterface(id, asked);
        });
        if (view === undefined) continue;
        const status = rec(rec(view).viewStatus);
        if (status.code !== undefined && status.code !== 0) {
          problems.push({ contractId, message: `view_status:${String(status.code)}` });
          continue;
        }
        const value = rec(rec(view).viewValue);
        const owner = str(value.owner);
        const amount = str(value.amount);
        const instrument = value.instrumentId;
        let key: string | null = null;
        let label = "";
        let admin: string | null = null;
        if (typeof instrument === "string" && instrument !== "") {
          key = instrument;
          label = instrument;
        } else if (str(rec(instrument).id) !== null && rec(instrument).id !== "") {
          admin = str(rec(instrument).admin);
          label = str(rec(instrument).id) ?? "";
          key = admin === null ? label : `${admin}:${label}`;
        }
        if (owner === null || amount === null || key === null) {
          problems.push({ contractId, message: "holding_view_shape_mismatch" });
          continue;
        }
        const decimal = readDecimal(amount);
        if (decimal === null) {
          problems.push({ contractId, message: `amount_not_decimal:${amount}` });
          continue;
        }
        const decaying = DECAYING.some((t) => t.module === parts[1] && t.entity === parts[2]);
        const holding: Holding = { contractId, amount, issuer: admin ?? "" };
        const at = `${key} ${owner}`;
        const group = sums.get(at);
        if (group === undefined) {
          sums.set(at, {
            instrumentId: label,
            instrumentAdmin: admin,
            owner,
            decaying,
            sum: decimal,
            contracts: [holding],
            mine,
          });
        } else {
          group.sum = addDecimals(group.sum, decimal);
          group.contracts.push(holding);
          if (decaying) group.decaying = true;
        }
      }
    }
    const groups = [...sums.values()].sort((a, b) => {
      const aMine = mine.includes(a.owner);
      const bMine = mine.includes(b.owner);
      if (aMine !== bMine) return aMine ? -1 : 1;
      if (a.owner !== b.owner) return a.owner < b.owner ? -1 : 1;
      return a.instrumentId < b.instrumentId ? -1 : a.instrumentId > b.instrumentId ? 1 : 0;
    });
    return { ok: true, pages: [], body: buildObject(AVAILABLE, { ctx, end, groups, problems }) };
  },
};
