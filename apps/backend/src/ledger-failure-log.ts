// **Why a 502 is diagnosable at all.** `interpretLedgerResponse` already derives a `detail` for every
// failing response (`ledger responded 400`, `…with a PRUNED error code`), and the router discards it: the
// only thing that leaves the process is the word `node_error`. Against a live participant that reads as
// "the node refused" about a node that is answering, and the next step is probing the participant from
// outside to recover what this process already knew. Which of the ledger calls failed is not recorded
// anywhere at all.
//
// So the detail is written to the operator's log here, at the one point every ledger call passes through —
// the send the boot file hands to the router. The HTTP response is untouched; its opacity to the caller is
// deliberate.
//
// Three rules this file keeps:
//   · **No credentials.** The request reaching this wrapper carries an `authorization` field (withAuth, or
//     the service transport). Only `method` and `path` are read, never the request object as a whole.
//   · **Nothing that came from outside.** `interpretLedgerResponse` puts only a fixed status-derived
//     summary in `detail` and never the response body; logging `detail` preserves that. A thrown transport
//     error is the other direction of the same rule — its message is foreign text, and
//     shared-identity.test.ts models exactly the case where it carries the configured client secret. So an
//     unreachable send is logged by path and reason, and its message is not written down.
//   · **No identifiers.** See `forLog` below.
import { interpretLedgerResponse, type LedgerSend } from "@canton-lens/core";

// `/v2/users/{userId}/rights` is the only ledger path that carries an identifier of a person. Which
// endpoint failed is the diagnosis; which user asked is not, so the segment is replaced. Every other path
// is either fixed or carries a package id, which is a content hash.
const USER_RIGHTS_PATH = /^\/v2\/users\/[^/]+\/rights$/;
const forLog = (path: string): string =>
  USER_RIGHTS_PATH.test(path) ? "/v2/users/{userId}/rights" : path;

// Matches the `[explorer-api] …` lines serve.mjs already prints at startup.
export const ledgerFailureLine = (
  method: string,
  path: string,
  reason: string,
  detail: string | undefined,
): string =>
  `[explorer-api] ledger ${method} ${forLog(path)} — ${reason}${detail === undefined ? "" : ` (${detail})`}`;

// Only the failures the caller cannot act on: node_error (502), unreachable (504) and too_many_elements
// (502). unauthenticated, forbidden, not_found, pruned and offset_after_ledger_end are routine outcomes
// driven by what the caller asked for, and a line per expired token or per missed point lookup would make
// this a request logger.
//
// too_many_elements is logged even though it does reach the caller under an accurate name, because no
// request the caller can make avoids it — the remedy is `http-list-max-elements-limit` on the node, and
// that is the operator's, the reader of this log. Since the list paths now ask in parts of
// LEDGER_PAGE_SIZE, a node still answering 413 is one configured below that page size; the line names the
// path whose limit to raise. The bound paginate.ts enforces on its own walk returns the same name without
// a failing response, so it does not pass here — that one is reported to the caller alone.
const LOGGED = new Set(["node_error", "unreachable", "too_many_elements"]);

export function logLedgerFailures(
  send: LedgerSend,
  log: (line: string) => void = (line) => console.error(line),
): LedgerSend {
  return async (request) => {
    let response: Awaited<ReturnType<LedgerSend>>;
    try {
      response = await send(request);
    } catch (error) {
      // The send never arrived. Which ledger call it was is the part this layer produced and the part the
      // call helpers cannot name; the thrown message is not written down (see the header).
      log(ledgerFailureLine(request.method, request.path, "unreachable", undefined));
      throw error;
    }
    if (response.status !== 200) {
      // Consults the one function that judges status codes rather than re-deriving the name, so the log
      // and the response agree — including the cases the ledger delivers by name (PRUNED,
      // OFFSET_AFTER_LEDGER_END, UPDATE_NOT_FOUND) rather than by status.
      const result = interpretLedgerResponse(response.status, response.body);
      if (!result.ok && LOGGED.has(result.reason)) {
        log(ledgerFailureLine(request.method, request.path, result.reason, result.detail));
      }
    }
    return response;
  };
}
