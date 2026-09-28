import type { LedgerCallResult } from "./types.ts";

// This one function in this file is the only place (chokepoint) that judges status codes.
// No other call-*.ts file branches on the status number directly.
//
// 200 → success. 401/403/404/500 → each a distinct failure reason.
// Every status code other than 200/401/403/404 (including other 5xx, and unspecified codes such as 429·502)
// is grouped as node_error — **and that is correct.** The shape of caller-supplied values is already validated
// by the router, which cuts them off with a 400 (negative offsets, malformed path segments), so if the ledger
// still answers 400 after that, **this layer built a malformed request**. That is a server fault, and a 5xx is
// the honest answer. The exceptions are the ones that arrive by name (PRUNED · OFFSET_AFTER_LEDGER_END ·
// UPDATE_NOT_FOUND · JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED), separated out below.
//
// detail carries only a fixed summary string derived from the status code. The raw server response (body)
// is never put into detail — no real 401/403/404/5xx error body has been captured,
// so we avoid inventing their shape.
export function interpretLedgerResponse<T>(status: number, body: unknown): LedgerCallResult<T> {
  if (status === 200) {
    return { ok: true, value: body as T };
  }
  // A pruned past arrives as an error name, not a status code (JsCantonError.code). It is the only material with which point lookups (update-by-id·by-offset)
  // can distinguish “a past the participant no longer retains” from “does not exist”. The raw body is not put into detail.
  if (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { code?: unknown }).code === "string" &&
    (body as { code: string }).code.includes("PRUNED")
  ) {
    return {
      ok: false,
      reason: "pruned",
      detail: `ledger responded ${status} with a PRUNED error code`,
    };
  }
  // **Asked for a point that has not arrived yet.** An offset past the ledger end has no answer even when
  // it is well-formed. The ledger answers with the name `OFFSET_AFTER_LEDGER_END`, so it is recognized by
  // name rather than by status code (the same way as PRUNED). Grouping this as node_error would report a
  // caller's fault as a 502 (a server fault), so it is kept separate. The mirror image of pruned:
  // “not yet” vs “not retained”.
  if (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { code?: unknown }).code === "string" &&
    (body as { code: string }).code === "OFFSET_AFTER_LEDGER_END"
  ) {
    return {
      ok: false,
      reason: "offset_after_ledger_end",
      detail: `ledger responded ${status} with an OFFSET_AFTER_LEDGER_END error code`,
    };
  }
  // **Does not exist, or is not visible.** For point lookups (update-by-id·by-offset) the ledger answers
  // this with the name `UPDATE_NOT_FOUND` rather than a status code ("Update not found, or not visible.").
  // So it was grouped as node_error (502) and “asked for something that does not exist” was reported as a
  // server error. The router always intended to answer this with a single 404 (the v1 rule that does not
  // separate “does not exist” from “cannot see it”) — recognizing the name makes it behave as intended.
  //
  // **Only `UPDATE_NOT_FOUND`, and only on an exact name match.** The ledger has several names ending in
  // `…_NOT_FOUND`, and this is the only one whose real response has been confirmed to mean “the caller asked
  // for something that does not exist” rather than “a node configuration problem”. To widen it, widen it on
  // the evidence of a real response at that time. (Matching by substring would move names like
  // `X_UPDATE_NOT_FOUND_Y` to 404 as well.)
  if (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { code?: unknown }).code === "string" &&
    (body as { code: string }).code === "UPDATE_NOT_FOUND"
  ) {
    return {
      ok: false,
      reason: "not_found",
      detail: `ledger responded ${status} with an UPDATE_NOT_FOUND error code`,
    };
  }
  // **The list is larger than the node will put in one response.** Canton's JSON API caps a list response at
  // `http-list-max-elements-limit` (default 200) and answers over that with
  // `413 JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED` ("The number of matching elements (201) is greater than
  // the node limit (200)."). The status is not among the ones mapped above, so it fell into node_error and an
  // operator was told the node refused, when nothing was broken. Recognized by name, like PRUNED ·
  // OFFSET_AFTER_LEDGER_END · UPDATE_NOT_FOUND, because the name is the only part that says which limit.
  //
  // **Exact name match only**, for the reason written above UPDATE_NOT_FOUND: matching by substring would
  // pull in any future name that merely contains this one.
  if (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { code?: unknown }).code === "string" &&
    (body as { code: string }).code === "JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED"
  ) {
    return {
      ok: false,
      reason: "too_many_elements",
      detail: `ledger responded ${status} with a JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED error code`,
    };
  }
  if (status === 401) {
    return { ok: false, reason: "unauthenticated", detail: "ledger responded 401" };
  }
  if (status === 403) {
    return { ok: false, reason: "forbidden", detail: "ledger responded 403" };
  }
  if (status === 404) {
    return { ok: false, reason: "not_found", detail: "ledger responded 404" };
  }
  return { ok: false, reason: "node_error", detail: `ledger responded ${status}` };
}
