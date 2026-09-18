// **GET /api/session, written out again by hand.**
//
// The one address every person reaches: it says who the node thinks is asking, which parties they hold and
// in what capacity, how wide their scope is, and what their own token claims about itself. The rules were
// written by reading router.ts, core/viewer-parties/build-viewer-parties.ts and
// core/token-claims/read-token-claims.ts, and stating again what they do.
//
// **The answer is a choice between two shapes**, and this is the first mapping that says so: `outcome:
// "view"` when the node's two answers could be read, `outcome: "unavailable"` with a reason when they could
// not. Describing only the first would leave the second unjudged while the check looked complete.
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
import { answerOf, arr, rec, str } from "./read-trace.ts";

// ── One party of mine ────────────────────────────────────────────────────────────

/** A party of mine, the capacities it was granted in, and the raw rights that named it. */
type Party = { party: string; kinds: string[]; rights: unknown[] };

const SESSION_PARTY: Record<string, Rule<Party>> = {
  party: node("party"),
  kinds: app(
    "CanReadAs, CanActAs, or both — in the order the rights first named this party in each capacity",
    (p) => p.kinds,
  ),
  rights: app(
    "every right of mine that names this party, copied from the node untouched — they are my own, so this is copying and not judgment",
    (p) => p.rights,
  ),
};

// ── What the token says about itself ─────────────────────────────────────────────

const TOKEN_CLAIMS: Record<string, Rule<Record<string, unknown>>> = {
  issuerHost: app(
    "the host of the token's iss when iss is a URL, else iss itself cut to eighty characters, else null — the path inside an issuer is not the browser's business",
    (claims) => {
      const iss = str(claims.iss);
      if (iss === null || iss === "") return null;
      try {
        return new URL(iss).host;
      } catch {
        return iss.slice(0, 80);
      }
    },
  ),
  audience: app(
    "the token's aud as a list: one string becomes a list of one, a list keeps its strings, anything else is empty",
    (claims) =>
      typeof claims.aud === "string"
        ? [claims.aud]
        : arr(claims.aud).filter((a): a is string => typeof a === "string"),
  ),
  expiresAt: app(
    "the token's exp read as seconds since the epoch and written as an instant, or null when there is none — so that an unknown expiry is not drawn as zero",
    (claims) =>
      typeof claims.exp === "number" && Number.isFinite(claims.exp)
        ? new Date(claims.exp * 1000).toISOString()
        : null,
  ),
};

/** The three claims, or null when the caller's token was not a decodable JWT. */
const tokenOf = (ctx: CheckContext): unknown =>
  ctx.callerToken === null ? null : buildObject(TOKEN_CLAIMS, ctx.callerToken);

// ── The two shapes of the answer ─────────────────────────────────────────────────

type Seen = { ctx: CheckContext; parties: Party[]; instanceWide: boolean };

const VIEW: Record<string, Rule<Seen>> = {
  outcome: app("view — the node answered both questions in the shapes this reads", () => "view"),
  userId: app("the node's user.id", (s) => str(rec(rec(userAnswer(s.ctx)).user).id)),
  primaryParty: app("the node's user.primaryParty", (s) =>
    str(rec(rec(userAnswer(s.ctx)).user).primaryParty),
  ),
  parties: app("one entry per party my rights name, in the order they first name it", (s) =>
    s.parties.map((party) => buildObject(SESSION_PARTY, party)),
  ),
  scope: app(
    "instance-wide when my rights include CanReadAsAnyParty as the node shapes it — an object holding an object — and own otherwise. Administering the participant is not reading from it, so ParticipantAdmin does not widen this",
    (s) => (s.instanceWide ? "instance-wide" : "own"),
  ),
  token: app("what my own token claims about itself, or null when it is not a JWT", (s) =>
    tokenOf(s.ctx),
  ),
  readAt: app("the instant the check handed the server as its clock", (s) => s.ctx.now.iso),
};

const UNAVAILABLE: Record<string, Rule<{ ctx: CheckContext; reason: string }>> = {
  outcome: app(
    "unavailable — one of the node's two answers was not the shape this reads",
    () => "unavailable",
  ),
  reason: app(
    "which of the two answers was not the shape, in this application's own words",
    (u) => u.reason,
  ),
  token: app("what my own token claims about itself, even here", (u) => tokenOf(u.ctx)),
  readAt: app("the instant the check handed the server as its clock", (u) => u.ctx.now.iso),
};

const SESSION_RESPONSE: Branches = {
  by: "outcome",
  of: [
    { when: ["view"], slots: VIEW },
    { when: ["unavailable"], slots: UNAVAILABLE },
  ],
};

const userAnswer = (ctx: CheckContext): unknown =>
  answerOf(ctx.trace, "GET", "/v2/authenticated-user");

export const sessionMapping: Mapping<CheckContext> = {
  root: "SessionResponse",
  slots: {
    SessionResponse: SESSION_RESPONSE,
    SessionParty: SESSION_PARTY,
    TokenClaims: TOKEN_CLAIMS,
  },
  expected: (ctx): Expectation => {
    const user = userAnswer(ctx);
    if (user === undefined) return { ok: false, why: "the trace holds no authenticated-user call" };
    // The two shapes the application refuses to read further. Stated here rather than assumed, because the
    // second branch of the answer exists exactly for them.
    if (!isObject(user) || !isObject(rec(user).user)) {
      return {
        ok: true,
        pages: [],
        body: buildObject(UNAVAILABLE, {
          ctx,
          reason: "The authenticated-user response has no user object.",
        }),
      };
    }
    const id = str(rec(rec(user).user).id);
    if (id === null) {
      return {
        ok: true,
        pages: [],
        body: buildObject(UNAVAILABLE, {
          ctx,
          reason: "user.id in the authenticated-user response is not a string.",
        }),
      };
    }
    if (str(rec(rec(user).user).primaryParty) === null) {
      return {
        ok: true,
        pages: [],
        body: buildObject(UNAVAILABLE, {
          ctx,
          reason: "user.primaryParty in the authenticated-user response is not a string.",
        }),
      };
    }
    const rightsCall = ctx.trace.find((call) => call.path.endsWith("/rights"));
    if (rightsCall === undefined) return { ok: false, why: "the trace holds no user-rights call" };
    const rightsList = rec(rightsCall.answer).rights;
    if (!Array.isArray(rightsList)) {
      return {
        ok: true,
        pages: [],
        body: buildObject(UNAVAILABLE, {
          ctx,
          reason: "The user-rights response has no rights array.",
        }),
      };
    }

    // The rights, read once: order of first appearance, one entry per party, both capacities kept.
    const order: string[] = [];
    const kindsOf = new Map<string, string[]>();
    let instanceWide = false;
    for (const item of rightsList) {
      const kind = rec(rec(item).kind);
      let namedAParty = false;
      for (const capacity of ["CanReadAs", "CanActAs"] as const) {
        const party = str(rec(rec(kind[capacity]).value).party);
        if (party === null) continue;
        namedAParty = true;
        if (!kindsOf.has(party)) {
          kindsOf.set(party, []);
          order.push(party);
        }
        const kinds = kindsOf.get(party) ?? [];
        if (!kinds.includes(capacity)) kinds.push(capacity);
      }
      // **Only CanReadAsAnyParty widens the scope, and only in the shape the node sends it in**: an object
      // holding an object. A bare key, null, false, `{}` at either level or an array is not that shape.
      // Administering the participant is a different thing from reading from it.
      if (
        !namedAParty &&
        isObject(kind.CanReadAsAnyParty) &&
        isObject(rec(kind.CanReadAsAnyParty).value)
      ) {
        instanceWide = true;
      }
    }
    const parties: Party[] = order.map((party) => ({
      party,
      kinds: kindsOf.get(party) ?? [],
      rights: rightsList.filter((right) =>
        Object.values(rec(rec(right).kind)).some((k) => rec(rec(k).value).party === party),
      ),
    }));
    return { ok: true, pages: [], body: buildObject(VIEW, { ctx, parties, instanceWide }) };
  },
};

/** A record and not an array — the node's right shapes are objects, and an array would read as one. */
const isObject = (value: unknown): boolean =>
  typeof value === "object" && value !== null && !Array.isArray(value);
