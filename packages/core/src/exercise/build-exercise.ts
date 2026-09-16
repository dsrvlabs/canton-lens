// The one write this layer builds: exercising a choice on a contract the caller can already see.
// Its security design is docs/ledger-writes.md; this file implements the "what is checked before
// submitting" section of it and nothing beyond.
//
// **This is not a permission check.** The participant decides whether the caller may act, whether the
// contract is still active, and whether the argument satisfies the template's `ensure` clause. It
// re-checks everything below and its answers are the authoritative ones. What this file buys is the
// difference between a `400` naming the field a form got wrong and a committed-transaction failure
// whose cause has to be read back out of a Canton error name.
//
// So the rule for adding a check here: check what the schema already states, and leave to the
// participant everything that depends on ledger state or rights.

import type { SchemaChoice, SchemaField, SchemaTemplate } from "../daml-lf/build-package-schema.ts";
import type { LfType } from "../daml-lf/lf2-package.ts";

export type ExerciseInput = {
  contractId: string;
  templateId: string;
  choice: string;
  // Field name → value, as the form produced it. An argument-less choice is `{}`, never null: the
  // node is sent a record either way, and `{}` says "the record has no fields" while null would
  // say "no argument was supplied", which is a different thing the node would refuse.
  argument: Record<string, unknown>;
  actAs: readonly string[];
};

export type ExerciseRejection =
  // The named choice is not on this template. Carries the names that are, because a form that sent a
  // stale choice name is one package version behind and the list is what says so.
  | { reason: "unknown_choice"; choice: string; available: string[] }
  | { reason: "missing_field"; field: string }
  | { reason: "unexpected_field"; field: string }
  | { reason: "wrong_type"; field: string; expected: string }
  | { reason: "no_act_as" }
  | { reason: "invalid_party"; party: string };

export type BuildExerciseResult =
  | { ok: true; command: ExerciseCommand }
  | { ok: false; rejection: ExerciseRejection };

// The shape the JSON Ledger API accepts inside a command list. Built here so that the request
// builder in ledger-request/ stays a transport concern and the judgment stays in core.
export type ExerciseCommand = {
  ExerciseCommand: {
    templateId: string;
    contractId: string;
    choice: string;
    choiceArgument: Record<string, unknown>;
  };
};

// Canton party identifiers are `hint::fingerprint`. The hint is chosen by whoever allocated the
// party and the fingerprint is hex. Matching the shape catches a form that sent a display name or an
// empty string; it does not and cannot tell whether the party exists — only the participant knows that.
const PARTY_PATTERN = /^[A-Za-z0-9:_\-. ]+::[0-9a-fA-F]+$/;

// Numeric arrives as text on the JSON API and must stay text: a Daml `Numeric 10` carries more
// precision than an IEEE double, so parsing it into a JavaScript number would silently round the
// value being committed. The same holds for Int64, whose range exceeds Number.MAX_SAFE_INTEGER.
const INT64_PATTERN = /^-?\d+$/;
const NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/;

function unwrapOptional(type: LfType): { inner: LfType; optional: true } | { optional: false } {
  if (type.kind === "builtin" && type.name === "Optional" && type.args[0] !== undefined) {
    return { inner: type.args[0], optional: true };
  }
  return { optional: false };
}

// Returns null when the value fits the type, or the type's name when it does not.
//
// Types this cannot judge return null as well — "not judged" and "accepted" are the same outcome
// here on purpose, because the alternative is refusing a well-formed argument the participant would
// have accepted. Gap 1 in docs/ledger-writes.md names the case this covers: a record from another
// package, which the schema decoder does not expand.
function typeMismatch(value: unknown, type: LfType): string | null {
  const opt = unwrapOptional(type);
  if (opt.optional) {
    // The JSON API encodes `None` as null and `Some x` as x itself.
    if (value === null) return null;
    return typeMismatch(value, opt.inner);
  }
  if (type.kind !== "builtin") return null;
  switch (type.name) {
    case "Text":
      return typeof value === "string" ? null : "Text";
    case "Party":
      if (typeof value !== "string") return "Party";
      return PARTY_PATTERN.test(value) ? null : "Party";
    case "ContractId":
      return typeof value === "string" && value !== "" ? null : "ContractId";
    case "Bool":
      return typeof value === "boolean" ? null : "Bool";
    case "Int64":
      // Accepted as text or as a number inside the safe-integer range. A number outside it has
      // already lost digits before reaching here, so it is refused rather than committed.
      if (typeof value === "string") return INT64_PATTERN.test(value) ? null : "Int64";
      if (typeof value === "number") return Number.isSafeInteger(value) ? null : "Int64";
      return "Int64";
    case "Numeric":
      if (typeof value === "string") return NUMERIC_PATTERN.test(value) ? null : "Numeric";
      return "Numeric";
    case "Date":
      // ISO-8601 date, as the JSON API emits and accepts it.
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : "Date";
    case "Timestamp":
      return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? null : "Timestamp";
    case "Unit":
      // The JSON encoding of `()` is an empty record.
      return typeof value === "object" && value !== null && !Array.isArray(value) ? null : "Unit";
    case "List":
      return Array.isArray(value) ? null : "List";
    default:
      // Every other builtin — TextMap, GenMap, BigNumeric and the rest — is passed through for the
      // participant to judge. A form cannot currently produce one.
      return null;
  }
}

function checkFields(
  argument: Record<string, unknown>,
  fields: readonly SchemaField[],
): ExerciseRejection | null {
  const declared = new Set(fields.map((field) => field.name));
  for (const supplied of Object.keys(argument)) {
    if (!declared.has(supplied)) return { reason: "unexpected_field", field: supplied };
  }
  for (const field of fields) {
    const value = argument[field.name];
    if (value === undefined) {
      // An absent Optional is the same as an explicit None, so it is not missing. Every other
      // absent field is: the node would refuse the record, and it names the record rather than
      // the field when it does.
      if (unwrapOptional(field.lfType).optional) continue;
      return { reason: "missing_field", field: field.name };
    }
    const mismatch = typeMismatch(value, field.lfType);
    if (mismatch !== null) {
      return { reason: "wrong_type", field: field.name, expected: mismatch };
    }
  }
  return null;
}

export function buildExercise(input: ExerciseInput, template: SchemaTemplate): BuildExerciseResult {
  const choice: SchemaChoice | undefined = template.choices.find((c) => c.name === input.choice);
  if (choice === undefined) {
    return {
      ok: false,
      rejection: {
        reason: "unknown_choice",
        choice: input.choice,
        available: template.choices.map((c) => c.name),
      },
    };
  }

  if (input.actAs.length === 0) return { ok: false, rejection: { reason: "no_act_as" } };
  for (const party of input.actAs) {
    if (!PARTY_PATTERN.test(party)) {
      return { ok: false, rejection: { reason: "invalid_party", party } };
    }
  }

  // argFields is null when the argument is not a record this package expands — gap 1 in
  // docs/ledger-writes.md. The argument is then passed through unchecked, which is the documented
  // behaviour and not an oversight.
  if (choice.argFields !== null) {
    const rejection = checkFields(input.argument, choice.argFields);
    if (rejection !== null) return { ok: false, rejection };
  }

  return {
    ok: true,
    command: {
      ExerciseCommand: {
        templateId: input.templateId,
        contractId: input.contractId,
        choice: input.choice,
        choiceArgument: input.argument,
      },
    },
  };
}
