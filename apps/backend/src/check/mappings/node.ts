// **GET /api/node, written out again by hand.**
//
// The status screen, and the one answer that reports what it does *not* know inside a 200 rather than as an
// error: a ledger end it could not read, a version it could not fetch. Four of its five slots are unions, so
// this mapping is mostly branches. The rules come from reading router.ts, core/node-status and
// core/node-live-status and stating again what they do.
//
// **It takes no party.** Nothing here is anybody's to see or not see — it is one instance-level fact read
// twice, which is why this address answers the same thing to a person holding no rights at all.
import {
  app,
  type Branches,
  buildObject,
  type CheckContext,
  type Expectation,
  type Mapping,
  type Rule,
} from "../mapping.ts";
import { answerOf, num, rec, str } from "./read-trace.ts";

/** What the two offset readings are: a number, or a reason there is none. */
type Reading = { offset: number | null; reason: string };

const READING_OK: Record<string, Rule<Reading>> = {
  status: app("ok — the node answered with a number", () => "ok"),
  offset: app("the offset the node reported", (r) => r.offset),
};
const READING_UNAVAILABLE: Record<string, Rule<Reading>> = {
  status: app("unavailable — the node did not answer with a number", () => "unavailable"),
  reason: app("why, in the same words every other ledger failure uses", (r) => r.reason),
};
const NODE_OFFSET_READING: Branches = {
  by: "status",
  of: [
    { when: ["ok"], slots: READING_OK },
    { when: ["unavailable"], slots: READING_UNAVAILABLE },
  ],
};

// **Progress is the comparison of two readings, and every way that comparison can fail is its own case.**
// Collapsing them would put "we could not read it" and "it did not move" in one box, and those are the two
// sentences this screen exists to keep apart.
const caseOnly = (name: string, sentence: string): Record<string, Rule<unknown>> => ({
  case: app(sentence, () => name),
});
const withDelta = (name: string, sentence: string): Record<string, Rule<{ delta: number }>> => ({
  case: app(sentence, () => name),
  delta: app("the current offset less the prior one", (p) => p.delta),
});

const NODE_LIVE_STATUS: Branches = {
  by: "case",
  of: [
    {
      when: ["advanced"],
      slots: withDelta("advanced", "both readings are numbers and the later one is bigger"),
    },
    {
      when: ["stalled"],
      slots: caseOnly("stalled", "both readings are numbers and they are equal"),
    },
    {
      when: ["regressed"],
      slots: withDelta("regressed", "both readings are numbers and the later one is smaller"),
    },
    {
      when: ["prior-unavailable"],
      slots: caseOnly("prior-unavailable", "there was no earlier reading to compare with"),
    },
    {
      when: ["current-unavailable"],
      slots: caseOnly("current-unavailable", "this call could not read the ledger end"),
    },
    {
      when: ["both-unavailable"],
      slots: caseOnly("both-unavailable", "neither reading is a number"),
    },
  ],
};

// **Elapsed is time, and it is the caller's time, not the server's.** This address takes the two instants as
// query parameters precisely so that the answer does not depend on a clock the caller cannot see.
const withMs = (name: string, sentence: string): Record<string, Rule<{ ms: number }>> => ({
  case: app(sentence, () => name),
  ms: app(
    "the observed instant of this call less the observed instant of the prior one",
    (e) => e.ms,
  ),
});

const NODE_ELAPSED: Branches = {
  by: "case",
  of: [
    {
      when: ["since-advance"],
      slots: withMs("since-advance", "the offset moved forward, and this is how long that took"),
    },
    {
      when: ["since-stall"],
      slots: withMs("since-stall", "the offset did not move, and this is how long it has not"),
    },
    {
      when: ["regressed-interval"],
      slots: withMs(
        "regressed-interval",
        "the offset went backwards, and this is the interval it did so in",
      ),
    },
    {
      when: ["clock-not-advanced"],
      slots: caseOnly(
        "clock-not-advanced",
        "the caller's two instants are the same or out of order, so no duration can be stated",
      ),
    },
    {
      when: ["not-yet-known"],
      slots: caseOnly(
        "not-yet-known",
        "one of the two readings is missing, so there is no interval to measure between them",
      ),
    },
  ],
};

type Version = { version: string | null; features: unknown; reason: string };

const VERSION_OK: Record<string, Rule<Version>> = {
  status: app("ok — the node answered the version question", () => "ok"),
  version: app("the node's version string", (v) => v.version),
  features: app(
    "the node's features, copied untouched — this application reads none of it",
    (v) => v.features,
  ),
};
const VERSION_UNAVAILABLE: Record<string, Rule<Version>> = {
  status: app("unavailable — the node did not answer the version question", () => "unavailable"),
  reason: app("why, in the same words every other ledger failure uses", (v) => v.reason),
};
const NODE_VERSION_FACT: Branches = {
  by: "status",
  of: [
    { when: ["ok"], slots: VERSION_OK },
    { when: ["unavailable"], slots: VERSION_UNAVAILABLE },
  ],
};

type Answer = { ctx: CheckContext; end: number | null; version: Version };

const NODE_RESPONSE: Record<string, Rule<Answer>> = {
  ledgerEnd: app(
    "the ledger end **this call** read — another read's offset in its place would hide a failed read behind a number",
    (a) =>
      a.end === null
        ? buildObject(READING_UNAVAILABLE, { offset: null, reason: "node_error" })
        : buildObject(READING_OK, { offset: a.end, reason: "" }),
  ),
  progress: app("with no earlier reading given, there is nothing to compare against", () =>
    buildObject(caseOnly("prior-unavailable", ""), undefined),
  ),
  elapsed: app("and with nothing compared, there is no interval either", () =>
    buildObject(caseOnly("not-yet-known", ""), undefined),
  ),
  version: app("what the node says its version is", (a) =>
    a.version.version === null
      ? buildObject(VERSION_UNAVAILABLE, a.version)
      : buildObject(VERSION_OK, a.version),
  ),
  readAt: app("the instant the check handed the server as its clock", (a) => a.ctx.now.iso),
};

export const nodeMapping: Mapping<CheckContext> = {
  root: "NodeResponse",
  slots: {
    NodeResponse: NODE_RESPONSE,
    NodeOffsetReading: NODE_OFFSET_READING,
    NodeLiveStatusResult: NODE_LIVE_STATUS,
    NodeElapsed: NODE_ELAPSED,
    NodeVersionFact: NODE_VERSION_FACT,
  },
  expected: (ctx): Expectation => {
    // **These rules describe the question the check asks: a current instant and no prior.** Given a prior,
    // progress and elapsed have five and four other branches, and none of them would be derived here.
    const query = new URL(ctx.url, "http://check").searchParams;
    if (query.get("priorOffset") !== null || query.get("priorObservedAtMs") !== null) {
      return {
        ok: false,
        why: "these rules do not describe a question carrying a prior reading yet",
      };
    }
    const endCall = ctx.trace.find(
      (call) => call.method === "GET" && call.path === "/v2/state/ledger-end",
    );
    if (endCall === undefined) return { ok: false, why: "the trace holds no ledger-end call" };
    const versionCall = ctx.trace.find(
      (call) => call.method === "GET" && call.path === "/v2/version",
    );
    if (versionCall === undefined) return { ok: false, why: "the trace holds no version call" };
    const version: Version = {
      version: str(rec(versionCall.answer).version),
      features: rec(versionCall.answer).features,
      // The reason words belong to the ledger-failure vocabulary, and a recorded call that answered is not
      // one of them — a mapping that had to name one would be describing a case the tape does not hold.
      reason: "node_error",
    };
    return {
      ok: true,
      pages: [],
      body: buildObject(NODE_RESPONSE, {
        ctx,
        end: num(rec(answerOf(ctx.trace, "GET", "/v2/state/ledger-end")).offset),
        version,
      }),
    };
  },
};
