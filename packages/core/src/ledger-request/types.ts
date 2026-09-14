// Shared types for handling layer 1 (Ledger API v2 JSON) requests/responses.
// This layer goes only as far as building requests and translating responses into the shape packages/core accepts.

// Represents a single ledger API call. No authentication header field is included —
// filling in headers is the responsibility of the LedgerSend implementation (the caller),
// and authentication/authorization decisions are made by the participant, not by our server.
export type LedgerRequest = {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  // The shape of the response body. Absent means JSON. "bytes" is a package download (ArchivePayload) — the sender receives it as an arrayBuffer and returns a Uint8Array.
  responseType?: "json" | "bytes";
};

// The function that actually sends the request. This layer itself never implements this function
// and only receives it as an argument. It may throw (network etc., when the target could not be reached).
export type LedgerSend = (request: LedgerRequest) => Promise<{ status: number; body: unknown }>;

// Fixes in the type system that non-200 responses point to different circumstances.
//   unauthenticated: 401 — token missing or expired
//   forbidden:        403 — asked for something outside one's permissions
//   not_found:        404 — the path or target does not exist
//   node_error:       5xx (and other unspecified status codes) — a problem on the node side
//   unreachable:      the sending function itself threw — could not be reached at all
//   offset_after_ledger_end: asked for a point that has not arrived yet — well-formed, but past the ledger end.
//                     The mirror image of pruned: pruned means “it existed but is not retained”, this means “not yet”.
//                     Both arrive as an error name (JsCantonError.code), not as a status code.
//   pruned:           asked for a past the participant has already pruned — when the error body's code contains PRUNED
//                     (the Canton PARTICIPANT_PRUNED_DATA_ACCESSED family). Different from “does not exist”: it existed but is not retained.
//   too_many_elements: the list is larger than this path will serve. It arrives as an error name
//                     (JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED) when the node's JSON API refuses to put more than
//                     `http-list-max-elements-limit` elements in one response, and it is also the name this layer gives
//                     its own bound when a paged list does not end within LEDGER_MAX_ELEMENTS / LEDGER_MAX_PAGES.
//                     Neither is the caller's fault and no request the caller can make avoids it — the remedy is the
//                     node's list limit, which is the operator's. Distinct from node_error so that the operator is told
//                     which limit, rather than “the node refused”.
export type LedgerFailureReason =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "node_error"
  | "unreachable"
  | "offset_after_ledger_end"
  | "pruned"
  | "too_many_elements";

export type LedgerCallOk<T> = { ok: true; value: T };

export type LedgerCallFailure = { ok: false; reason: LedgerFailureReason; detail?: string };

export type LedgerCallResult<T> = LedgerCallOk<T> | LedgerCallFailure;
