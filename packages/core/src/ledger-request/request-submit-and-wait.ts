// The only request in this layer that asks the participant to commit something rather than to
// answer. Its security design is docs/ledger-writes.md; the judgment about whether the command is
// well-formed happened before this file, in exercise/build-exercise.ts.
//
// `submit-and-wait` rather than `submit`: the screen has to say whether the transaction committed,
// and the asynchronous form answers only that the command was accepted for processing. A command
// that is accepted and then fails in interpretation would be reported as success.

import { interpretLedgerResponse } from "./interpret.ts";
import type { LedgerCallResult, LedgerRequest, LedgerSend } from "./types.ts";

// What the participant returns once the transaction is committed. Only the fields the screen shows
// are named; the node sends more and the rest is ignored rather than re-exported.
export type SubmittedCommand = {
  updateId: string;
  completionOffset: number | null;
};

export function buildSubmitAndWaitRequest(
  command: unknown,
  actAs: readonly string[],
  commandId: string,
  userId: string | null,
): LedgerRequest {
  return {
    method: "POST",
    path: "/v2/commands/submit-and-wait",
    body: {
      commands: [command],
      commandId,
      actAs: [...actAs],
      // readAs is left empty deliberately. A choice that needs to read a contract the acting party
      // cannot see is a disclosure problem, and widening the read scope here would hide it behind a
      // submission that sometimes works. docs/ledger-writes.md names disclosure as out of scope.
      readAs: [],
      // The node fills the acting user in from the token when this is absent. It is sent only when
      // the caller's token names one, so that a deployment whose tokens carry no user id is not
      // refused for supplying an empty string.
      ...(userId === null ? {} : { userId }),
    },
  };
}

// Canton requires a command id and deduplicates on it within its deduplication window. Gap 4 in
// docs/ledger-writes.md is that this is a fresh id per call: two identical submissions are two
// commands, not one retried command. Making them one needs an id the caller chooses, which is an
// API change this route has not made.
function readSubmittedCommand(body: unknown): SubmittedCommand | null {
  if (typeof body !== "object" || body === null) return null;
  const updateId = (body as { updateId?: unknown }).updateId;
  if (typeof updateId !== "string" || updateId === "") return null;
  const offset = (body as { completionOffset?: unknown }).completionOffset;
  return { updateId, completionOffset: typeof offset === "number" ? offset : null };
}

export async function callSubmitAndWait(
  send: LedgerSend,
  command: unknown,
  actAs: readonly string[],
  commandId: string,
  userId: string | null,
): Promise<LedgerCallResult<SubmittedCommand>> {
  // Built outside the catch, for the reason given in request-update-by-id.ts: a request that was
  // never sent must not be reported as `unreachable`.
  const request = buildSubmitAndWaitRequest(command, actAs, commandId, userId);
  let status: number;
  let body: unknown;
  try {
    ({ status, body } = await send(request));
  } catch (error) {
    // **A write that could not be sent is not a write that did not happen.** The request may have
    // reached the participant and the response may have been lost on the way back. The caller is
    // told the transport failed and nothing else, because nothing else is known; the update list is
    // where the outcome is actually visible.
    return {
      ok: false,
      reason: "unreachable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  const interpreted = interpretLedgerResponse<unknown>(status, body);
  if (!interpreted.ok) return interpreted;
  const submitted = readSubmittedCommand(interpreted.value);
  if (submitted === null) {
    // A 200 whose body carries no update id is not a committed transaction this layer can name. It
    // is reported as a node error rather than as success, because the alternative is telling the
    // screen a command committed on the strength of a status code alone.
    return { ok: false, reason: "node_error", detail: "submission returned no update id" };
  }
  return { ok: true, value: submitted };
}
