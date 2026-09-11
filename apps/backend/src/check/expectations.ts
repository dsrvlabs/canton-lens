// **What is asked, and what counts as passing.** This file is the check's standard.
//
// The judgment has three levels (spec: "the design of the check"):
//   ① it answers      — no 5xx. Asked with a token, so it should be 200.
//   ② it matches      — it passes the openapi 200 schema (`additionalProperties:false` + `required`).
//   ③ it has content  — a list such as `rows` being empty is a failure.
//
// Why ③ is needed: **an empty array means JSON Schema's `items` never runs at all.** So ② can be green while
// most of the schema went unchecked. ③ is the precondition for ②.
//
// Writing the minimum only as "one or more" is deliberate — an exact count breaks on one line of seeding.
// Where the requirement is a *property* rather than a count ("every package decodes"), it is written as a
// property: that does not move with the seed, and it catches what a count cannot.
import type { EndpointSpec } from "./run-check.ts";

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
    filled: (body) => {
      const outcome = rec(body).outcome;
      if (outcome !== "view") {
        return `outcome is not "view" (${String(outcome)}) — this person has no parties`;
      }
      return len(body, "parties") >= 1 ? null : "parties is empty";
    },
  },
  {
    template: "/api/contracts",
    url: () => "/api/contracts",
    filled: (body) =>
      len(body, "rows") >= 1 ? null : `rows is empty (total=${String(rec(body).total)})`,
  },
  {
    // Asked once more with a **small** pageSize. Asked with the default, the seed fits in a single page and
    // `nextCursor` is always null, so the shape of a paged response is never checked at all.
    template: "/api/contracts",
    url: () => "/api/contracts?pageSize=2",
    name: "/api/contracts?pageSize=2",
    filled: (body) => (len(body, "rows") >= 1 ? null : "rows is empty"),
  },
  {
    template: "/api/updates",
    url: () => "/api/updates",
    filled: (body) => (len(body, "rows") >= 1 ? null : "rows is empty"),
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
    filled: (body) => {
      const groups = arr(rec(body).groups).map(rec);
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
    filled: (body) => {
      const cards = rec(rec(body).cards);
      if (cards.status !== "ok") return `cards.status is not "ok" (${String(cards.status)})`;
      for (const name of ["activeContracts", "pendingOffers", "tokens"]) {
        const card = cards[name];
        if (card === undefined) return `cards.${name} is absent`;
        const status = rec(card).status;
        if (status !== "ok") {
          return `cards.${name}.status is not "ok" (${String(status)} · ${String(rec(card).reason)})`;
        }
      }
      return null;
    },
  },
  {
    template: "/api/holdings",
    url: () => `/api/holdings?holdingInterfaceId=${q(HOLDING)}`,
    name: "/api/holdings",
    filled: (body) => {
      const b = rec(body);
      if (b.kind !== "available") return `kind is not "available" (${String(b.reason)})`;
      return len(b, "view", "groups") >= 1 ? null : "view.groups is empty";
    },
  },
  {
    template: "/api/preapprovals",
    url: (_h, now) => `/api/preapprovals?asOf=${q(now.iso)}`,
    name: "/api/preapprovals",
    filled: (body) => {
      const b = rec(body);
      if (b.kind !== "available") return `kind is not "available" (${String(b.reason)})`;
      return len(b, "view", "rows") >= 1 ? null : "view.rows is empty";
    },
  },
  {
    template: "/api/offers",
    // interfaceId is **required** here alone — without "an offer of which standard", the question does not stand.
    url: (_h, now) => `/api/offers?interfaceId=${q(TRANSFER_INSTRUCTION)}&asOf=${q(now.iso)}`,
    name: "/api/offers",
    filled: (body) => {
      const b = rec(body);
      if (b.kind !== "available") return `kind is not "available" (${String(b.reason)})`;
      return len(b, "view", "rows") >= 1 ? null : "view.rows is empty";
    },
  },
  {
    template: "/api/catalog/templates",
    url: () => "/api/catalog/templates",
    // Having rows is not enough — when a definition cannot be read it becomes
    // `definition.status:"unavailable"` and the field and choice schemas beneath it go unchecked. Written as
    // "every one is read" (a property, not a count) — otherwise a run with every definition unavailable passes as green.
    filled: (body) => {
      const rows = arr(rec(body).rows).map(rec);
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
    filled: (body) => {
      const b = rec(body);
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
