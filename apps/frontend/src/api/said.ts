// Only carries the failure name the server gave over into human words, as is. The screen does not invent circumstances.
export const SAID: Record<string, string> = {
  shared_identity_unavailable:
    "Service access is unavailable. Contact your operator; individual sign-in is not supported.",
  shared_identity_forbidden:
    "The configured shared identity has insufficient Canton rights. Contact your operator.",
  shared_identity_authorization_not_allowed:
    "The gateway forwarded an authentication header that Explorer cannot accept in Shared Identity Mode. Contact your operator.",
  unauthenticated: "No token, or it has expired",
  forbidden: "Outside this user's rights",
  no_party_rights:
    "This account has no party rights on this participant, so there is nothing to show",
  no_own_parties:
    "This account reads as every party on the participant and holds none of its own, so there is no 'mine' to report here",
  not_found:
    "No such thing — or it is outside what you can see. Archived contracts are not in this view",
  node_error: "The node refused",
  too_many_elements:
    "This list is larger than the node will return in one response. Ask your operator to raise the participant's JSON API list limit",
  unreachable: "Could not reach the node",
  exchange_failed: "Could not exchange the login token for a ledger token",
  explorer_unreachable: "The front could not reach the Explorer — is it running?",
  upstream_failed: "The front could not reach its upstream",
  pruned: "The participant no longer keeps this part of the past",
  invalid_before: "The page cursor is not a number",
  invalid_offset: "That offset is not a whole number — negative values are not offsets",
  offset_after_ledger_end:
    "That offset is later than the ledger's end — it has not happened yet. Try again without an offset",
  invalid_path: "That id is not the right shape",
  invalid_page_size: "The page size must be a whole number of 1 or more",
  invalid_cursor: "The page cursor is not a whole number",
  invalid_as_of: "The 'as of' time is missing or is not a time",
  invalid_interface_id: "The interface id is empty — leave it out instead",
  invalid_limit: "The row limit must be a whole number of 1 or more",
  invalid_window: "The window's start must not come after its end",
  window_too_wide: "That window is wider than 5,000 offsets — narrow it, or read it in parts",
};

// Failure name → phrase. A name not in the dictionary is exposed as is (that too is what the server said).
export const said = (reason: string | undefined | null, fallback = "reason unknown"): string =>
  reason === undefined || reason === null ? fallback : (SAID[reason] ?? reason);

// Why the decoder could not read the schema — named ones in human words; an unknown code is not exposed as is but as one phrase (the code goes in title).
export const saidSchema = (status: unknown): string => {
  if (typeof status !== "string") return "Could not read the schema";
  if (SAID[status]) return SAID[status];
  if (status.startsWith("unsupported_lf_version:"))
    return `Daml-LF version ${status.slice("unsupported_lf_version:".length)} is not supported (LF 2.1 to 2.3 only)`;
  return "Could not read the schema";
};

// The kind of search input — the judgment is the server's (core classifySearchInput); only the names here.
export const SAID_KIND: Record<string, string> = {
  contract_id: "contract ID",
  update_id: "update ID",
  party: "party",
  package_id: "package id",
  template_or_interface_fqn: "template or interface — same shape, cannot tell them apart",
  interface_id_confirmed: "interface id",
  empty: "nothing entered",
  unrecognized: "unrecognized",
};
