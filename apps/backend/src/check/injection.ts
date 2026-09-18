// **Breaking one thing on purpose, and requiring the answer to say so.**
//
// Every level so far reads an answer the node was able to give. Nothing in them can see the failure this
// product is most likely to have and least likely to notice: **a read that failed, served as though nothing
// was there.** An empty list is a perfectly good answer to "what do I own"; it is a catastrophic answer to
// "what do I own, when the read fell over". The two are the same bytes.
//
// The recording cannot reach that, and not for want of data: a tape holds what the node *did* answer. So the
// failures are put in on purpose. One node call is replaced by a failure, everything else is left alone, and
// the question is whether the answer that comes back is still a claim about the ledger.
//
// **Only the four that actually happen** (0단계 measured the first two against a real participant):
//   413              the node refuses a list longer than `http-list-max-elements-limit`. Measured: a
//                    participant with 201 active contracts answered exactly this and the screen went dark.
//   the node is down the connection does not open at all. `send` throws, which is a different path in this
//                    application from "the node answered badly" and reaches a different status (504).
//   an endless walk  every page comes back full and carrying a position to continue from, so the walk never
//                    ends. What must not happen is serving the part collected as though it were the whole.
//   a 500           the node answered, badly. The plainest one, and the one every path must survive.
import type { LedgerRequest, LedgerSend } from "@canton-lens/core";

export type Give =
  | "413"
  | "down"
  | "endless"
  | "500"
  // **The named ones.** Canton reports these as a *name* in the body rather than as a status, and this
  // application reads the name — so a recording can never reach them (the node answered every recorded
  // question) and nor can a made-up status. The words below are the node's own.
  | "401"
  | "403"
  | "pruned"
  | "not_found"
  | "after_the_end";

/** Which node call to break: the first one whose path starts with this. */
export type When = { path: string };

export type Injection = { when: When; give: Give };

/**
 * Canton's own words for the two failures it reports by name. Copied from a real participant's answer —
 * this application recognises the **name**, not the status, so a made-up body would take a different path
 * through `interpretLedgerResponse` than the real thing and the test would be about nothing.
 */
const TOO_MANY = {
  status: 413,
  body: {
    code: "JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED",
    cause: "The number of matching elements (201) is greater than the node limit (200).",
  },
};

const A_PAGE_THAT_NEVER_ENDS = (path: string): unknown => {
  // Full and carrying a position to continue from, forever. The shape has to be the endpoint's own, because
  // the walk reads the continuation from the last element of the page.
  const rows = Array.from({ length: 200 }, (_, n) =>
    path.startsWith("/v2/updates")
      ? {
          update: {
            Transaction: { value: { updateId: `1220${"ff".repeat(32)}`, offset: n, events: [] } },
          },
        }
      : {
          contractEntry: {
            JsActiveContract: {
              createdEvent: {
                contractId: `00${"ff".repeat(68)}`.slice(0, 138),
                templateId: "ffff:Made.Up:Nothing",
                packageName: "made-up",
                createArgument: {},
                signatories: [],
                observers: [],
                witnessParties: [],
                createdAt: "2026-01-01T00:00:00Z",
                interfaceViews: [],
                offset: n,
              },
            },
          },
          streamContinuationToken: "never-ends",
        },
  );
  return rows;
};

export type Injector = {
  send: LedgerSend;
  /** How many calls the injection actually replaced. Zero means the test proved nothing. */
  hits: () => number;
};

/**
 * Wraps `send` and breaks the **first** call whose path matches, leaving every other call untouched.
 *
 * First rather than all: breaking every matching call cannot tell "this read is not defended" from "one of
 * several reads is not defended", and the second is the one that gets shipped. The exception is the endless
 * walk, which is a claim about repetition and so answers every page.
 */
export function injectingSend(real: LedgerSend, injection: Injection): Injector {
  let hit = 0;
  return {
    hits: () => hit,
    send: async (request: LedgerRequest) => {
      if (!request.path.startsWith(injection.when.path)) return real(request);
      if (injection.give === "endless") {
        hit += 1;
        return { status: 200, body: A_PAGE_THAT_NEVER_ENDS(request.path) };
      }
      if (hit > 0) return real(request);
      hit += 1;
      if (injection.give === "down") {
        // **Thrown, not returned.** A connection that never opened is not a status, and this application
        // reaches `unreachable` (504) only down the throwing path.
        throw new Error("connect ECONNREFUSED (injected)");
      }
      if (injection.give === "413") return TOO_MANY;
      if (injection.give === "401") return { status: 401, body: { cause: "injected" } };
      if (injection.give === "403") return { status: 403, body: { cause: "injected" } };
      // A past the participant no longer keeps. **Its whole point is that it is not "does not exist"** — the
      // caller asked about something that was real, and saying "no such thing" would be a different claim.
      if (injection.give === "pruned") {
        return {
          status: 400,
          body: { code: "PARTICIPANT_PRUNED_DATA_ACCESSED", cause: "injected" },
        };
      }
      if (injection.give === "not_found") {
        // **400, not 404** (interpret.test.ts: "the status code is not 404"). Injected as a 404 it reached
        // `not_found` through the plain status mapping, so the name-recognising branch this exists to
        // exercise could have been deleted with the test still green (2026-09-18 codex).
        return { status: 400, body: { code: "UPDATE_NOT_FOUND", cause: "injected" } };
      }
      if (injection.give === "after_the_end") {
        return { status: 400, body: { code: "OFFSET_AFTER_LEDGER_END", cause: "injected" } };
      }
      return { status: 500, body: { code: "INTERNAL", cause: "injected" } };
    },
  };
}

// ── Judging what came back ───────────────────────────────────────────────────────

const everyRecord = function* (value: unknown): Generator<Record<string, unknown>> {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) yield* everyRecord(item);
    return;
  }
  yield value as Record<string, unknown>;
  for (const item of Object.values(value as Record<string, unknown>)) yield* everyRecord(item);
};

/**
 * Every word this answer uses to say how something went — the values of `status`, `kind`, `schemaStatus`,
 * `reason` and `schemaReason`, wherever they appear.
 *
 * **Not a list of failure words.** A list would have to be kept, and the first time this application named a
 * new kind of failure the list would not have it: the catalogue answers a package it could not fetch with
 * `schemaStatus: "node_error"` and fields reading `unavailable_in_this_layer`, neither of which a hand-written
 * list of failure words had in it (2026-09-18) — so the sweep said "it swallowed the failure" about an
 * application that had reported it perfectly well.
 *
 * What is compared instead is **which words the answer uses at all**, healthy against injured. A read that
 * fell over has to make the answer say something it was not saying before; which word is the application's
 * business, and having to say one is this test's.
 */
export function statusWords(body: unknown): string[] {
  const found = new Set<string>();
  for (const record of everyRecord(body)) {
    for (const key of ["status", "kind", "schemaStatus", "reason", "schemaReason"]) {
      const at = record[key];
      if (typeof at === "string") found.add(`${key}=${at}`);
    }
  }
  return [...found].sort();
}

export type Answer = { status: number; body: unknown };

/**
 * What is wrong with the way this answer took the failure, if anything.
 *
 * Two ways to take it well, and they are genuinely different answers rather than two spellings of one:
 *   · the whole answer is a named failure — the read this address *is* could not be done;
 *   · the answer is a 200 that names the part that failed — one section of a screen went dark and the rest
 *     of it is true. The package catalogue is the case: one blueprint this node cannot decode does not make
 *     the catalogue a lie.
 *
 * The finding is the third thing: a 200 that says nothing. And the fourth, which looks like success and is
 * worse — **an answer identical to the healthy one**, which means the read that just failed was one this
 * answer never needed, and nobody knows that.
 */
export function howItTookTheFailure(
  healthy: Answer,
  injured: Answer,
  /**
   * The name the injected failure has to come out under (`node_error` for a node that answered badly).
   *
   * **Without it this oracle passes ordinary domain states.** "Any word it was not saying before" is
   * satisfied by `kind: "empty"` and by `status: "out_of_scope"` — a screen going quietly blank is an answer
   * that says something new, and it said nothing about the read (2026-09-18 codex). The failure the node
   * gave is a specific one, so what is required is that specific one: named on the whole answer, or against
   * the part of it that went dark.
   */
  named: string,
): string | null {
  if (injured.status !== 200) {
    const reason = (injured.body as { reason?: unknown } | null)?.reason;
    if (reason === named) return null;
    return typeof reason === "string"
      ? `answered ${injured.status} ${reason} — the node's failure was ${named}, and renaming it loses what an operator would act on`
      : `answered ${injured.status} with no reason — a failure has to be named to be acted on`;
  }
  // A 200 that names the part that went dark. The name has to be the node's, in the same place the healthy
  // answer said everything was well — `schemaStatus: "node_error"` where it said "ok".
  const before = new Set(statusWords(healthy.body));
  const said = statusWords(injured.body).filter((word) => !before.has(word));
  if (said.some((word) => word.endsWith(`=${named}`))) return null;
  if (JSON.stringify(healthy.body) === JSON.stringify(injured.body)) {
    return "the answer did not change at all — this read was made and then not used";
  }
  return said.length === 0
    ? "answered 200 and said nothing about the read that failed"
    : `answered 200 and said ${said.join(" · ")} — none of which is the node's ${named}`;
}
