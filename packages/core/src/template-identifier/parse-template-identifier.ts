// Parser for the fully qualified template identifier `<package>:<module>:<entity>`.
// The templateId in a layer 1 response has the shape `<packageId hash>:<Module>:<Entity>` — the first piece being named
// package_name is a misnomer: the name is kept for the callers that already read it, but what the field holds is
// the packageId. The callers (contract-list·recent-updates etc.) know that fact via comments.
//
// There is no matcher on the triple (package·module·entity): that would need a table of installed templates to
// match against, and layer 1 serves none.

export type ParsedTemplateIdentifier = {
  ok: true;
  package_name: string;
  module_name: string;
  entity_name: string;
};

export type ParseTemplateIdentifierFailureReason =
  | "empty_string"
  | "malformed_arity"
  | "empty_segment";

export type ParseTemplateIdentifierFailure = {
  ok: false;
  reason: ParseTemplateIdentifierFailureReason;
};

export type ParseTemplateIdentifierResult =
  | ParsedTemplateIdentifier
  | ParseTemplateIdentifierFailure;

export function parseTemplateFqn(input: string): ParseTemplateIdentifierResult {
  if (input === "") {
    return { ok: false, reason: "empty_string" };
  }
  const parts = input.split(":");
  if (parts.length !== 3) {
    return { ok: false, reason: "malformed_arity" };
  }
  // Length 3 was checked above, so all three pieces must exist. noUncheckedIndexedAccess cannot see that
  // check, so after narrowing with ?? "" the empty-string check also filters out that case.
  const package_name = parts[0] ?? "";
  const module_name = parts[1] ?? "";
  const entity_name = parts[2] ?? "";
  if (package_name === "" || module_name === "" || entity_name === "") {
    return { ok: false, reason: "empty_segment" };
  }
  return { ok: true, package_name, module_name, entity_name };
}
