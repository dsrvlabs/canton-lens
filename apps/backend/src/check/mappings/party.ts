// **GET /api/party/{partyId}, written out again by hand.**
//
// **This address does not ask whether a party exists.** It reads my own active contracts and picks out the
// ones that party appears in — which is why the answer's scope says `counterparty` and not `party`: it is
// what that party and I have between us, not that party's holdings. A party I share nothing with and a party
// that was never allocated give the same answer, and the rules below say so rather than papering over it:
// the question "does this party exist" belongs to an admin API that refuses a user token.
//
// Written by reading router.ts and core/search/search-party-in-active-contracts.ts.
import {
  app,
  type Branches,
  buildObject,
  type CheckContext,
  type Expectation,
  type Mapping,
  type Rule,
} from "../mapping.ts";
import { arr, ledgerEnd, rec, str, stringsOf, wildcardAcsPages } from "./read-trace.ts";

type Answer = { ctx: CheckContext; end: number; party: string; contractIds: string[] };

const FOUND: Record<string, Rule<Answer>> = {
  status: app("found — at least one of my active contracts names this party", () => "found"),
  scope: app(
    "counterparty — the fixed marker that this is only what appears together with me, never the whole of that party",
    () => "counterparty",
  ),
  party: app("the party the address asked about, echoed back decoded", (a) => a.party),
  contractIds: app(
    "the id of every active contract of mine where that party is a signatory or an observer, in the order the node sent them — a witness does not count, because being shown a contract is not appearing in it",
    (a) => a.contractIds,
  ),
  offset: app("the offset the contracts were read at", (a) => a.end),
  readAt: app("the instant the check handed the server as its clock", (a) => a.ctx.now.iso),
};

const OUT_OF_SCOPE: Record<string, Rule<Answer>> = {
  status: app(
    "out_of_scope — none of my active contracts names this party. It does not say the party is unknown, and it must not: this application cannot tell the two apart",
    () => "out_of_scope",
  ),
  party: app("the party the address asked about, echoed back decoded", (a) => a.party),
  offset: app("the offset the contracts were read at", (a) => a.end),
  readAt: app("the instant the check handed the server as its clock", (a) => a.ctx.now.iso),
};

const PARTY_RESPONSE: Branches = {
  by: "status",
  of: [
    { when: ["found"], slots: FOUND },
    { when: ["out_of_scope"], slots: OUT_OF_SCOPE },
  ],
};

export const partyMapping: Mapping<CheckContext> = {
  root: "PartyResponse",
  slots: { PartyResponse: PARTY_RESPONSE },
  expected: (ctx): Expectation => {
    const end = ledgerEnd(ctx.trace);
    if (end === null) return { ok: false, why: "the trace holds no ledger end" };
    const asked = ctx.url.split("?")[0]?.split("/").pop() ?? "";
    const party = decodeURIComponent(asked);
    const pages = wildcardAcsPages(ctx.trace);
    if (pages.length === 0) {
      return { ok: false, why: "the trace holds no unnarrowed active-contracts call" };
    }
    const contractIds: string[] = [];
    for (const page of pages) {
      for (const item of arr(page.answer)) {
        const event = rec(rec(rec(rec(item).contractEntry).JsActiveContract).createdEvent);
        const contractId = str(event.contractId);
        if (contractId === null) {
          return { ok: false, why: "an active-contracts entry carries no contract id" };
        }
        const involved = [...stringsOf(event.signatories), ...stringsOf(event.observers)];
        if (involved.includes(party)) contractIds.push(contractId);
      }
    }
    const answer: Answer = { ctx, end, party, contractIds };
    return {
      ok: true,
      pages: [],
      body:
        contractIds.length === 0 ? buildObject(OUT_OF_SCOPE, answer) : buildObject(FOUND, answer),
    };
  },
};
