import assert from "node:assert/strict";
import test from "node:test";
import type { SchemaField, SchemaTemplate } from "../daml-lf/build-package-schema.ts";
import type { BuiltinName, LfType } from "../daml-lf/lf2-package.ts";
import { buildExercise, type ExerciseInput } from "./build-exercise.ts";

const builtin = (name: BuiltinName): LfType => ({ kind: "builtin", name, args: [] });
const optional = (inner: LfType): LfType => ({ kind: "builtin", name: "Optional", args: [inner] });
const field = (name: string, lfType: LfType): SchemaField => ({
  name,
  type: name,
  lfType,
});

const ALICE = "alice::1220abcdef";
const BOB = "bob::1220fedcba";

const template = (argFields: SchemaField[] | null): SchemaTemplate => ({
  module: "Iou",
  name: "Iou",
  fields: [],
  choices: [
    { name: "Iou_Transfer", consuming: true, argType: "Iou_Transfer", argFields, returnType: null },
    { name: "Iou_Peek", consuming: false, argType: null, argFields: [], returnType: "Decimal" },
  ],
  key: null,
  implements: [],
});

const input = (over: Partial<ExerciseInput> = {}): ExerciseInput => ({
  contractId: "00abc",
  templateId: "pkg:Iou:Iou",
  choice: "Iou_Transfer",
  argument: { newOwner: BOB },
  actAs: [ALICE],
  ...over,
});

test("a well-formed argument becomes an ExerciseCommand the node accepts", () => {
  const result = buildExercise(input(), template([field("newOwner", builtin("Party"))]));
  assert.ok(result.ok);
  assert.deepEqual(result.command, {
    ExerciseCommand: {
      templateId: "pkg:Iou:Iou",
      contractId: "00abc",
      choice: "Iou_Transfer",
      choiceArgument: { newOwner: BOB },
    },
  });
});

test("a choice name the template does not have is refused, and the answer names the ones it has", () => {
  const result = buildExercise(
    input({ choice: "Iou_Split" }),
    template([field("newOwner", builtin("Party"))]),
  );
  assert.ok(!result.ok);
  assert.equal(result.rejection.reason, "unknown_choice");
  assert.deepEqual(
    result.rejection.reason === "unknown_choice" ? result.rejection.available : [],
    ["Iou_Transfer", "Iou_Peek"],
    "the available names are what tell a stale form it is a package version behind",
  );
});

test("a field the choice does not declare is refused rather than passed through", () => {
  const result = buildExercise(
    input({ argument: { newOwner: BOB, memo: "hi" } }),
    template([field("newOwner", builtin("Party"))]),
  );
  assert.ok(!result.ok);
  assert.equal(result.rejection.reason, "unexpected_field");
});

test("a required field left out is refused; an absent Optional is not missing", () => {
  const fields = [field("newOwner", builtin("Party")), field("memo", optional(builtin("Text")))];
  const missing = buildExercise(input({ argument: {} }), template(fields));
  assert.ok(!missing.ok);
  assert.equal(missing.rejection.reason, "missing_field");
  assert.equal(
    missing.rejection.reason === "missing_field" ? missing.rejection.field : "",
    "newOwner",
  );

  // The node treats an absent Optional and an explicit None as the same record, so refusing the
  // first would refuse an argument it would have accepted.
  const withoutOptional = buildExercise(input({ argument: { newOwner: BOB } }), template(fields));
  assert.ok(withoutOptional.ok);

  const explicitNone = buildExercise(
    input({ argument: { newOwner: BOB, memo: null } }),
    template(fields),
  );
  assert.ok(explicitNone.ok);
});

test("a value of the wrong type is refused and the answer names the field", () => {
  const result = buildExercise(
    input({ argument: { newOwner: "not-a-party" } }),
    template([field("newOwner", builtin("Party"))]),
  );
  assert.ok(!result.ok);
  assert.equal(result.rejection.reason, "wrong_type");
  assert.equal(result.rejection.reason === "wrong_type" ? result.rejection.field : "", "newOwner");
});

test("Int64 and Numeric keep their text form, and a number that already lost digits is refused", () => {
  const fields = [field("amount", builtin("Numeric")), field("count", builtin("Int64"))];
  const asText = buildExercise(
    input({ argument: { amount: "10.0000000001", count: "9007199254740993" } }),
    template(fields),
  );
  assert.ok(asText.ok, "text is the form that survives a Numeric wider than a double");

  // Written as an expression rather than a literal: the literal 9007199254740993 is already
  // 9007199254740992 by the time it is parsed, which is exactly the loss this check exists to refuse.
  const unsafe = buildExercise(
    input({ argument: { amount: "1.0", count: Number.MAX_SAFE_INTEGER + 2 } }),
    template(fields),
  );
  assert.ok(!unsafe.ok);
  assert.equal(unsafe.rejection.reason, "wrong_type");

  const notANumber = buildExercise(
    input({ argument: { amount: "ten", count: "1" } }),
    template(fields),
  );
  assert.ok(!notANumber.ok);
});

test("actAs must name at least one syntactically well-formed party", () => {
  const fields = [field("newOwner", builtin("Party"))];
  const none = buildExercise(input({ actAs: [] }), template(fields));
  assert.ok(!none.ok);
  assert.equal(none.rejection.reason, "no_act_as");

  const malformed = buildExercise(input({ actAs: ["alice"] }), template(fields));
  assert.ok(!malformed.ok);
  assert.equal(malformed.rejection.reason, "invalid_party");
});

test("an argument this package does not expand is passed through for the node to judge", () => {
  // Gap 1 in docs/ledger-writes.md: argFields is null for a record from another package. Refusing
  // it here would refuse a well-formed argument, so it is sent as it is.
  const result = buildExercise(input({ argument: { anything: { nested: 1 } } }), template(null));
  assert.ok(result.ok);
  assert.deepEqual(result.command.ExerciseCommand.choiceArgument, { anything: { nested: 1 } });
});

test("an argument-less choice takes an empty record, not null", () => {
  const result = buildExercise(
    input({ choice: "Iou_Peek", argument: {} }),
    template([field("newOwner", builtin("Party"))]),
  );
  assert.ok(result.ok);
  assert.deepEqual(result.command.ExerciseCommand.choiceArgument, {});
});
