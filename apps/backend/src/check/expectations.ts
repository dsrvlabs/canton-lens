// **What is asked, and what counts as passing.** This file is the check's standard.
//
// The judgment has four levels (spec: "the design of the check"):
//   ① it answers      — no 5xx. Asked with a token, so it should be 200.
//   ② it matches      — it passes the openapi 200 schema (`additionalProperties:false` + `required`).
//   ③ it has content  — a list such as `rows` being empty is a failure.
//   ④ it is derived   — every value is what the rules in check/mappings/ say the node's answer produces.
//                       Only the addresses that have rules are judged at this level; the rest stop at ③.
//
// Why ③ is needed: **an empty array means JSON Schema's `items` never runs at all.** So ② can be green while
// most of the schema went unchecked. ③ is the precondition for ②.
//
// Writing the minimum only as "one or more" is deliberate — an exact count breaks on one line of seeding.
// Where the requirement is a *property* rather than a count ("every package decodes"), it is written as a
// property: that does not move with the seed, and it catches what a count cannot.
import { canRead, type Given } from "./given.ts";
import type { EndpointSpec } from "./run-check.ts";

// ── What the answer depends on ───────────────────────────────────────────────────
// **Most of these addresses have no one right answer — they have a right answer for this person.** A viewer
// with no reading scope is answered 403 on everything that needs a party, and a person the seed gave nothing
// is answered 200 with an empty list. Both are correct, and both used to be recorded as failures, which meant
// the check could only ever run as a fully-provisioned user — the user whose answers reveal the least.
//
// The statements below say what each address owes each person. They are judged **both ways**: a 403 where
// this person should have been served is a defect, and so is a 200 where they should have been refused.

/**
 * The router answers 403 no_party_rights to a viewer with no reading scope (router.ts:252, :287-289).
 * `canRead`, not the party count, is the test: a super reader holds no party of their own and reads every one
 * of them.
 */
const needsAParty = (given: Given) =>
  canRead(given) ? { status: 200 } : { status: 403, reason: "no_party_rights" };

/** There is no id to put in the address, because this person's list of them is legitimately empty. */
const nothingToNameIt = (given: Given): string | null => {
  if (!canRead(given)) return "holds no reading scope, so the list this id comes from is refused";
  if (!given.seesAnything) return "the seed put nothing on the ledger this person can see";
  return null;
};

// **The two interface ids of the Splice token standard (CIP-56).** This API takes "which standard should I look
// through" from the caller — a design that keeps the standard out of the code (required for `/api/offers`,
// optional elsewhere). The UI holds the same values as its own defaults
// (apps/frontend/src/session/SessionContext.tsx). If these ever diverge from the UI's, the check would be walking
// a path the UI never takes, so the divergence itself is the defect.
const HOLDING = "#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding";
const TRANSFER_INSTRUCTION =
  "#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction";
const q = encodeURIComponent;

// Small helpers for pulling one list out. Many paths answer with a union (available / unavailable), so the
// branch is separated first — an "unavailable" branch arriving is something ② accepts, so ③ has to say it.
const rec = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const len = (body: unknown, ...path: string[]): number => {
  let at: unknown = body;
  for (const key of path) at = rec(at)[key];
  return arr(at).length;
};

// ── Round one: the ten that need nothing substituted into the path ───────────────
// The values round two needs (a contract id, an update id, an offset, a package id, a party) are harvested
// from these answers.
export const ROUND_ONE: readonly EndpointSpec[] = [
  {
    template: "/api/session",
    url: () => "/api/session",
    // An outcome of unavailable is still a 200 (by design). So only "it says view but has no parties" is a
    // failure — unavailable means the ledger granted no rights, and then every later round is meaningless,
    // which is worth saying separately.
    // **The party list is compared with the node's own rights, not merely counted.** "One or more" would pass
    // a response that dropped two of alice's three, and it would fail every viewer whose empty list is right.
    filled: (body, given) => {
      const b = rec(body);
      if (b.outcome !== "view") return `outcome is not "view" (${String(b.outcome)})`;
      const shown = arr(b.parties)
        .map(rec)
        .map((p) => String(p.party));
      const missing = given.parties.filter((p) => !shown.includes(p));
      const extra = shown.filter((p) => !given.parties.includes(p));
      if (missing.length > 0 || extra.length > 0) {
        return `parties do not match the rights — ${missing.length} missing, ${extra.length} not granted`;
      }
      // The scope is the other half of the same fact: reading every party is not the same as holding many.
      const wanted = given.readsEveryParty ? "instance-wide" : "own";
      return b.scope === wanted ? null : `scope is ${String(b.scope)}, expected ${wanted}`;
    },
  },
  {
    template: "/api/contracts",
    url: () => "/api/contracts",
    status: needsAParty,
    // **Empty is required of a person the seed gave nothing, not merely allowed.** A row arriving for them
    // would be someone else's contract on their screen, which is the worst of the defects this check exists
    // to catch — so the emptiness is stated, and a row breaks it.
    filled: (body, given) => {
      const total = rec(body).total;
      if (given.seesAnything)
        return len(body, "rows") >= 1 ? null : `rows is empty (total=${String(total)})`;
      return len(body, "rows") === 0 && total === 0
        ? null
        : `the seed gave this person nothing, and yet ${len(body, "rows")} rows arrived (total=${String(total)})`;
    },
  },
  {
    // Asked once more with a **small** pageSize. Asked with the default, the seed fits in a single page and
    // `nextCursor` is always null, so the shape of a paged response is never checked at all.
    template: "/api/contracts",
    url: () => "/api/contracts?pageSize=2",
    name: "/api/contracts?pageSize=2",
    status: needsAParty,
    filled: (body, given) =>
      given.seesAnything
        ? len(body, "rows") >= 1
          ? null
          : "rows is empty"
        : len(body, "rows") === 0
          ? null
          : `the seed gave this person nothing, and yet ${len(body, "rows")} rows arrived`,
  },
  {
    template: "/api/updates",
    url: () => "/api/updates",
    status: needsAParty,
    filled: (body, given) =>
      given.seesAnything
        ? len(body, "rows") >= 1
          ? null
          : "rows is empty"
        : len(body, "rows") === 0
          ? null
          : `the seed gave this person nothing, and yet ${len(body, "rows")} rows arrived`,
  },
  {
    template: "/api/timeline",
    // Asks with the window **pinned.** The default (the most recent 100 offsets) is a number chosen for the
    // screen's convenience, so it can change at any time, and when it does this check would ask for a range
    // the recorded ledger does not hold and break for a reason that has nothing to do with the product.
    // from=1 asks exactly for the range the tape holds (from 0) — the window is [from, offset] and only the
    // ledger call uses an exclusive start.
    url: () => "/api/timeline?from=1",
    // Two nested lists — groups, and the lifetimes inside them. An empty group array would leave every
    // lifetime field unchecked by ②, and a group with no lines would do the same one level down.
    status: needsAParty,
    filled: (body, given) => {
      const groups = arr(rec(body).groups).map(rec);
      if (!given.seesAnything) {
        return groups.length === 0
          ? null
          : `the seed gave this person nothing, and yet ${groups.length} groups arrived`;
      }
      if (groups.length === 0) return "groups is empty";
      return groups.every((g) => arr(g.lines).length >= 1) ? null : "a group carries no lifetimes";
    },
  },
  {
    template: "/api/home",
    // asOf is **required** — this layer does not read a clock, so the caller supplies the "now" for judging
    // expiry. Both standard interfaces are passed too: without them the token card answers on its
    // "does not know the standard" branch and the schema beneath it goes unchecked.
    url: (_h, now) =>
      `/api/home?asOf=${q(now.iso)}&interfaceId=${q(TRANSFER_INSTRUCTION)}&holdingInterfaceId=${q(HOLDING)}`,
    name: "/api/home",
    // **"The card is present" is not enough.** Each card has `status: "ok" | "unavailable"` and both pass the
    // contract — a response with all three cards unavailable used to pass this check as green.
    // In that state not one of the numbers or lists inside the cards is checked.
    filled: (body, given) => {
      const cards = rec(rec(body).cards);
      // This path is 200 for everyone; who the person is decides what is *inside*. With no reading scope the
      // whole card block names the circumstance instead of carrying numbers (measured against the router).
      if (!canRead(given)) {
        return cards.status === "no_party_rights"
          ? null
          : `cards.status is ${String(cards.status)}, expected "no_party_rights"`;
      }
      if (cards.status !== "ok") return `cards.status is not "ok" (${String(cards.status)})`;
      // **The two token cards need a party of one's own, and a super reader has none.** Their answer is
      // `no_own_parties`, which is not a failure — it is the true thing to say. Demanding "ok" of them here
      // is what used to make a super reader's correct home read as broken.
      const ownParties = given.parties.length > 0;
      for (const name of ["activeContracts", "pendingOffers", "tokens"]) {
        const card = cards[name];
        if (card === undefined) return `cards.${name} is absent`;
        const status = rec(card).status;
        const wanted = !ownParties && name !== "activeContracts" ? "unavailable" : "ok";
        if (status !== wanted) {
          return `cards.${name}.status is ${String(status)} (${String(rec(card).reason)}), expected "${wanted}"`;
        }
      }
      return null;
    },
  },
  {
    template: "/api/holdings",
    url: () => `/api/holdings?holdingInterfaceId=${q(HOLDING)}`,
    name: "/api/holdings",
    status: needsAParty,
    filled: (body, given) => {
      const b = rec(body);
      if (b.kind !== "available") return `kind is not "available" (${String(b.reason)})`;
      const groups = len(b, "view", "groups");
      if (!given.seesAnything) {
        return groups === 0
          ? null
          : `the seed gave this person nothing, and yet ${groups} groups arrived`;
      }
      return groups >= 1 ? null : "view.groups is empty";
    },
  },
  {
    template: "/api/preapprovals",
    url: (_h, now) => `/api/preapprovals?asOf=${q(now.iso)}`,
    name: "/api/preapprovals",
    status: needsAParty,
    filled: (body, given) => {
      const b = rec(body);
      if (b.kind !== "available") return `kind is not "available" (${String(b.reason)})`;
      const rows = len(b, "view", "rows");
      if (!given.seesAnything) {
        return rows === 0
          ? null
          : `the seed gave this person nothing, and yet ${rows} rows arrived`;
      }
      return rows >= 1 ? null : "view.rows is empty";
    },
  },
  {
    template: "/api/offers",
    // interfaceId is **required** here alone — without "an offer of which standard", the question does not stand.
    url: (_h, now) => `/api/offers?interfaceId=${q(TRANSFER_INSTRUCTION)}&asOf=${q(now.iso)}`,
    name: "/api/offers",
    status: needsAParty,
    filled: (body, given) => {
      const b = rec(body);
      if (b.kind !== "available") return `kind is not "available" (${String(b.reason)})`;
      const rows = len(b, "view", "rows");
      if (!given.seesAnything) {
        return rows === 0
          ? null
          : `the seed gave this person nothing, and yet ${rows} rows arrived`;
      }
      return rows >= 1 ? null : "view.rows is empty";
    },
  },
  {
    template: "/api/catalog/templates",
    url: () => "/api/catalog/templates",
    // Having rows is not enough — when a definition cannot be read it becomes
    // `definition.status:"unavailable"` and the field and choice schemas beneath it go unchecked. Written as
    // "every one is read" (a property, not a count) — otherwise a run with every definition unavailable passes as green.
    status: needsAParty,
    // The rows come from **my** active contracts, so a person the seed gave nothing has none of them —
    // unlike the package catalog below, whose rows are every installed package.
    filled: (body, given) => {
      const rows = arr(rec(body).rows).map(rec);
      if (!given.seesAnything) {
        return rows.length === 0
          ? null
          : `the seed gave this person nothing, and yet ${rows.length} templates arrived`;
      }
      if (rows.length === 0) return "rows is empty";
      const unreadable = rows.filter((r) => rec(r.definition).status !== "ok");
      if (unreadable.length > 0) {
        const say = unreadable
          .slice(0, 3)
          .map(
            (r) => `${String(r.module)}:${String(r.entity)}(${String(rec(r.definition).reason)})`,
          )
          .join(" · ");
        return `${unreadable.length}/${rows.length} template definitions could not be read — ${say}`;
      }
      return null;
    },
  },
  {
    template: "/api/catalog/packages",
    url: () => "/api/catalog/packages",
    // **Having rows is not enough.** A package whose blueprint could not be read still produces a row (with
    // the reason in schemaStatus), and then the templates·interfaces beneath it are empty arrays and the
    // schema goes unchecked — exactly the hole ③ exists to block. Corrupting one package's bytes left this
    // green until the property below was written.
    //
    // Written as a **property**, not a count ("every one is read"). It does not move with the seed, and all 38
    // packages decoded on the real node too. If a package with an LF version we cannot read ever arrives,
    // this is what says so.
    status: needsAParty,
    // **No `seesAnything` branch here on purpose.** These rows are every package installed on the
    // participant (GET /v2/packages), not the packages my contracts use, so they are there for a person the
    // seed gave nothing too. Only `inMyContracts` goes empty for them.
    filled: (body) => {
      const rows = arr(rec(body).rows).map(rec);
      if (rows.length === 0) return "rows is empty";
      const unreadable = rows.filter((r) => r.schemaStatus !== "ok");
      if (unreadable.length > 0) {
        // **Not named by `name`.** That value only exists once the package is decoded
        // (`string | UnavailableInThisLayer`), so a row that failed to decode has none — building a sentence
        // from it prints `[object Object]`. packageId is always there.
        const say = unreadable
          .slice(0, 3)
          .map((r) => `${String(r.packageId).slice(0, 12)}…(${String(r.schemaStatus)})`)
          .join(" · ");
        return `${unreadable.length}/${rows.length} package blueprints could not be read — ${say}`;
      }
      return null;
    },
  },
  {
    template: "/api/node",
    // currentObservedAtMs is **required** (same reason — this layer does not read the time). prior* is not
    // passed: with neither present it means "not known yet", which is what a first page load looks like.
    url: (_h, now) => `/api/node?currentObservedAtMs=${now.ms}`,
    name: "/api/node",
    // There is no count on this path — ③ is judged by **whether what should have been read was read**.
    // Checking only that the fields exist lets `version.status:"unavailable"` and
    // `ledgerEnd.status:"unavailable"` through, and then not one of the version, feature-list or offset
    // schemas is checked.
    filled: (body) => {
      const b = rec(body);
      const version = rec(b.version);
      if (version.status !== "ok") {
        return `version.status is not "ok" (${String(version.status)} · ${String(version.reason)})`;
      }
      const end = rec(b.ledgerEnd);
      if (end.status !== "ok") {
        return `ledgerEnd.status is not "ok" (${String(end.status)} · ${String(end.reason)})`;
      }
      return null;
    },
  },
];

// ── Round two: the six that substitute a harvested value into the path ───────────
// When a value could not be harvested the item **fails rather than being skipped**. "Round one was empty so
// round two could not be asked" must never pass as green — that is the very hole ③ was meant to block.
export const ROUND_TWO: readonly EndpointSpec[] = [
  {
    template: "/api/contracts/{contractId}",
    url: (h) => (h.contractId ? `/api/contracts/${encodeURIComponent(h.contractId)}` : null),
    need: "contractId (rows[0] of /api/contracts)",
    status: needsAParty,
    unaskable: nothingToNameIt,
    // `schema.status` is checked too — unavailable also passes the contract, so with only that arriving, not
    // one of the field, choice or typedPayload schemas is checked.
    filled: (body) => {
      const b = rec(body);
      if (b.templateId === undefined) return "templateId is absent";
      const schema = rec(b.schema);
      if (schema.status !== "ok") return `schema.status is not "ok" (${String(schema.reason)})`;
      return len(schema, "fields") >= 1 ? null : "schema.fields is empty";
    },
  },
  {
    template: "/api/updates/{updateId}",
    url: (h) => (h.updateId ? `/api/updates/${encodeURIComponent(h.updateId)}` : null),
    need: "updateId (rows[0] of /api/updates)",
    status: needsAParty,
    unaskable: nothingToNameIt,
    // Only the transaction branch has events. If another branch arrived (a reassignment, say), say so.
    filled: (body) => {
      const b = rec(body);
      if (b.kind !== "transaction") return `kind is not "transaction" (${String(b.kind)})`;
      return len(b, "events") >= 1 ? null : "events is empty";
    },
  },
  {
    template: "/api/updates/by-offset/{offset}",
    url: (h) => (h.offset === null ? null : `/api/updates/by-offset/${h.offset}`),
    need: "offset (rows[0].offset of /api/updates)",
    status: needsAParty,
    unaskable: nothingToNameIt,
    filled: (body) => {
      const b = rec(body);
      if (b.kind !== "transaction") return `kind is not "transaction" (${String(b.kind)})`;
      return len(b, "events") >= 1 ? null : "events is empty";
    },
  },
  {
    template: "/api/packages/{packageId}/schema",
    url: (h) => (h.packageId ? `/api/packages/${h.packageId}/schema` : null),
    // Picks a package **whose blueprint can be read**. The seed also carries ones that cannot (an older LF
    // version), and picking one of those would bring the `status:"unavailable"` branch and leave the
    // blueprint-side schema unchecked.
    need: 'packageId (the first row of /api/catalog/packages with schemaStatus === "ok")',
    // **Not gated on the seed.** The catalog this id comes from is every installed package, so anyone with a
    // reading scope can name one — including a person whose own contract list is empty.
    unaskable: (given) =>
      canRead(given) ? null : "holds no reading scope, so the package catalog is refused",
    filled: (body) => {
      const b = rec(body);
      if (b.status !== "ok") return `status is not "ok" (${String(b.reason)})`;
      return len(b, "modules") >= 1 ? null : "modules is empty";
    },
  },
  {
    template: "/api/party/{partyId}",
    url: (h) => (h.partyId ? `/api/party/${encodeURIComponent(h.partyId)}` : null),
    need: "partyId (parties[0].party of /api/session)",
    status: needsAParty,
    // **A super reader has no party of their own to name here.** Reading every party is not holding one, and
    // the session's party list is where this id comes from.
    unaskable: (given) =>
      given.parties.length > 0 ? null : "holds no party of their own, so the session names none",
    // "found" means the party appears in at least one of *my* active contracts
    // (core/search/search-party-in-active-contracts.ts). With no contract of my own, my own party is
    // out_of_scope — that is the honest answer, not a failure.
    filled: (body, given) => {
      const b = rec(body);
      if (!given.seesAnything) {
        return b.status === "out_of_scope"
          ? null
          : `status is ${String(b.status)}, expected "out_of_scope" for a person with no contract`;
      }
      if (b.status !== "found") return `status is not "found" (${String(b.status)})`;
      return len(b, "contractIds") >= 1 ? null : "contractIds is empty";
    },
  },
  {
    // Search is not full-text search — it **classifies** a pasted id into one of seven kinds. So a real
    // contract id is what carries it all the way to "classified and found". Empty input and unknown shapes
    // belong to the unit tests (classify-search-input).
    template: "/api/search",
    url: (h) => (h.contractId ? `/api/search?q=${encodeURIComponent(h.contractId)}` : null),
    need: "contractId (rows[0] of /api/contracts)",
    status: needsAParty,
    unaskable: nothingToNameIt,
    filled: (body) => {
      const b = rec(body);
      if (b.kind !== "contract_id") return `kind is not "contract_id" (${String(b.kind)})`;
      // Results come per section as `{status, rows}` — asked with a contract id, only the contracts section
      // is "ok" and the other four are "not_applicable". So "the contracts section is ok and has rows" is
      // what it means for this question to have stood.
      const contracts = rec(rec(b.results).contracts);
      if (contracts.status !== "ok") {
        return `results.contracts.status is not "ok" (${String(contracts.status)})`;
      }
      return len(contracts, "rows") >= 1 ? null : "results.contracts.rows is empty";
    },
  },
];

// Harvests the values round two needs from round one's answers. What cannot be harvested stays null, and
// round two states that as a failure.
export type Harvest = {
  contractId: string | null;
  updateId: string | null;
  offset: number | null;
  packageId: string | null;
  partyId: string | null;
};

export function harvest(bodies: ReadonlyMap<string, unknown>): Harvest {
  const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
  const rows = (url: string): Record<string, unknown>[] => arr(rec(bodies.get(url)).rows).map(rec);

  const firstUpdate = rows("/api/updates")[0];
  const okPackage = rows("/api/catalog/packages").find((r) => r.schemaStatus === "ok");
  const firstParty = arr(rec(bodies.get("/api/session")).parties).map(rec)[0];

  return {
    contractId: str(rows("/api/contracts")[0]?.contractId),
    updateId: str(firstUpdate?.updateId),
    offset: typeof firstUpdate?.offset === "number" ? firstUpdate.offset : null,
    packageId: str(okPackage?.packageId),
    partyId: str(firstParty?.party),
  };
}
