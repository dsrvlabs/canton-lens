// JSON payload value × LF type → **typed label-value rows** (the material for the Contracts detail Payload render — landing point 1 of build-package-schema).
//
// Matches the schema against the JSON Ledger API value encoding: record → object (field names) · variant → {tag, value} · enum → string · Optional → null|value
// (nested Optional is [] / [value]) · List → array · TextMap → object · GenMap → [[k, v]] · Numeric/Int64 → string (or number) · Party/ContractId/Text →
// string · Date → "YYYY-MM-DD" · Timestamp → ISO · Unit → {}.
// **On a mismatch only that field falls back to raw** — values are never invented or altered (design decision). The screen looks at kind to attach links (party·contract).

import { findDataType, type PackageSchema } from "./build-package-schema.ts";
import type { LfType, PackageRef } from "./lf2-package.ts";
import { typeHead, typeText } from "./type-text.ts";

export type TypedValue =
  | {
      kind: "party" | "contractId" | "text" | "numeric" | "int64" | "date" | "timestamp" | "enum";
      type: string;
      value: string;
    }
  | { kind: "bool"; type: string; value: boolean }
  | { kind: "unit"; type: string }
  | { kind: "none"; type: string }
  | { kind: "list"; type: string; items: TypedValue[] }
  | { kind: "record"; type: string; fields: TypedField[] }
  | { kind: "variant"; type: string; tag: string; value: TypedValue }
  | { kind: "map"; type: string; entries: { key: TypedValue; value: TypedValue }[] }
  | { kind: "raw"; type: string; value: unknown; why: string };

export type TypedField = { name: string; value: TypedValue };

const MAX_DEPTH = 32;

function raw(type: string, value: unknown, why: string): TypedValue {
  return { kind: "raw", type, value, why };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Type variable substitution — plugs the actual arguments into a record data type's parameters (e.g. Tuple2 a b).
function substitute(t: LfType, env: ReadonlyMap<string, LfType>): LfType {
  switch (t.kind) {
    case "var": {
      const bound = env.get(t.name);
      if (bound !== undefined && t.args.length === 0) return bound;
      return { ...t, args: t.args.map((a) => substitute(a, env)) };
    }
    case "builtin":
    case "con":
    case "syn":
      return { ...t, args: t.args.map((a) => substitute(a, env)) };
    case "app":
      return { kind: "app", lhs: substitute(t.lhs, env), rhs: substitute(t.rhs, env) };
    case "struct":
      return {
        kind: "struct",
        fields: t.fields.map((f) => ({ name: f.name, type: substitute(f.type, env) })),
      };
    default:
      return t;
  }
}

export type SchemaLookup = (pkg: PackageRef, module: string, name: string) => PackageSchema | null;

export function typeValue(
  value: unknown,
  type: LfType,
  self: PackageSchema,
  lookup: SchemaLookup,
  depth = 0,
): TypedValue {
  const text = typeText(type);
  if (depth > MAX_DEPTH) return raw(text, value, "depth_exceeded");
  const head = typeHead(type);
  if (head.kind === "builtin") {
    const a0 = head.args[0];
    const a1 = head.args[1];
    switch (head.name) {
      case "Party":
        return typeof value === "string"
          ? { kind: "party", type: text, value }
          : raw(text, value, "expected_string");
      case "ContractId":
        return typeof value === "string"
          ? { kind: "contractId", type: text, value }
          : raw(text, value, "expected_string");
      case "Text":
        return typeof value === "string"
          ? { kind: "text", type: text, value }
          : raw(text, value, "expected_string");
      case "Numeric":
      case "BigNumeric":
        return typeof value === "string" || typeof value === "number"
          ? { kind: "numeric", type: text, value: String(value) }
          : raw(text, value, "expected_decimal");
      case "Int64":
        return typeof value === "string" || typeof value === "number"
          ? { kind: "int64", type: text, value: String(value) }
          : raw(text, value, "expected_integer");
      case "Bool":
        return typeof value === "boolean"
          ? { kind: "bool", type: text, value }
          : raw(text, value, "expected_boolean");
      case "Date":
        return typeof value === "string"
          ? { kind: "date", type: text, value }
          : raw(text, value, "expected_string");
      case "Timestamp":
        return typeof value === "string"
          ? { kind: "timestamp", type: text, value }
          : raw(text, value, "expected_string");
      case "Unit":
        return isRecord(value) && Object.keys(value).length === 0
          ? { kind: "unit", type: text }
          : raw(text, value, "expected_empty_object");
      case "Optional": {
        if (a0 === undefined) return raw(text, value, "optional_without_argument");
        if (value === null) return { kind: "none", type: text };
        // Nested Optional arrives as [] / [value]
        const innerHead = typeHead(a0);
        if (innerHead.kind === "builtin" && innerHead.name === "Optional") {
          if (Array.isArray(value)) {
            if (value.length === 0) return { kind: "none", type: text };
            return typeValue(value[0], a0, self, lookup, depth + 1);
          }
          return raw(text, value, "nested_optional_expected_array");
        }
        return typeValue(value, a0, self, lookup, depth + 1);
      }
      case "List":
        if (a0 === undefined || !Array.isArray(value)) return raw(text, value, "expected_array");
        return {
          kind: "list",
          type: text,
          items: value.map((v) => typeValue(v, a0, self, lookup, depth + 1)),
        };
      case "TextMap":
        if (a0 === undefined || !isRecord(value)) return raw(text, value, "expected_object");
        return {
          kind: "map",
          type: text,
          entries: Object.entries(value).map(([k, v]) => ({
            key: { kind: "text", type: "Text", value: k },
            value: typeValue(v, a0, self, lookup, depth + 1),
          })),
        };
      case "GenMap":
        if (a0 === undefined || a1 === undefined || !Array.isArray(value))
          return raw(text, value, "expected_pairs");
        return {
          kind: "map",
          type: text,
          entries: value.map((pair) =>
            Array.isArray(pair) && pair.length === 2
              ? {
                  key: typeValue(pair[0], a0, self, lookup, depth + 1),
                  value: typeValue(pair[1], a1, self, lookup, depth + 1),
                }
              : { key: raw("?", pair, "expected_pair"), value: raw("?", null, "expected_pair") },
          ),
        };
      default:
        return raw(text, value, `not_a_serializable_builtin:${head.name}`);
    }
  }
  if (head.kind === "con") {
    const schema = head.pkg.kind === "self" ? self : lookup(head.pkg, head.module, head.name);
    if (schema === null) return raw(text, value, "type_definition_not_loaded");
    const def = findDataType(schema, head.module, head.name);
    if (def === null) return raw(text, value, "type_definition_not_found");
    // Parameter substitution — the data type's parameter names are not read from the LF surface (TypeVarWithKind gives only the count), so match by position:
    // map the var names in the field types to the arguments in order of appearance. If there are more names than arguments, fall back to raw.
    const varNames: string[] = [];
    const collect = (t: LfType) => {
      if (t.kind === "var" && !varNames.includes(t.name)) varNames.push(t.name);
      if (t.kind === "builtin" || t.kind === "con" || t.kind === "syn" || t.kind === "var")
        for (const a of t.args) collect(a);
      if (t.kind === "app") {
        collect(t.lhs);
        collect(t.rhs);
      }
      if (t.kind === "struct") for (const f of t.fields) collect(f.type);
    };
    if (def.cons.kind === "record" || def.cons.kind === "variant")
      for (const f of def.cons.fields) collect(f.lfType);
    const env = new Map<string, LfType>();
    varNames.forEach((n, i) => {
      const a = head.args[i];
      if (a !== undefined) env.set(n, a);
    });
    if (def.cons.kind === "record") {
      if (!isRecord(value)) return raw(text, value, "expected_object");
      return {
        kind: "record",
        type: text,
        fields: def.cons.fields.map((f) => ({
          name: f.name,
          value: typeValue(value[f.name], substitute(f.lfType, env), schema, lookup, depth + 1),
        })),
      };
    }
    if (def.cons.kind === "variant") {
      if (!isRecord(value) || typeof value.tag !== "string")
        return raw(text, value, "expected_tag_value");
      const arm = def.cons.fields.find((f) => f.name === value.tag);
      if (arm === undefined) return raw(text, value, `unknown_variant_tag:${value.tag}`);
      return {
        kind: "variant",
        type: text,
        tag: value.tag,
        value: typeValue(value.value, substitute(arm.lfType, env), schema, lookup, depth + 1),
      };
    }
    if (def.cons.kind === "enum") {
      return typeof value === "string" && def.cons.constructors.includes(value)
        ? { kind: "enum", type: text, value }
        : raw(text, value, "unknown_enum_constructor");
    }
    return raw(text, value, "interface_has_no_values");
  }
  return raw(text, value, `unsupported_type_shape:${head.text}`);
}

// A template's createArgument, field by field.
export function typeRecordFields(
  value: unknown,
  fields: readonly { name: string; lfType: LfType }[],
  self: PackageSchema,
  lookup: SchemaLookup,
): TypedField[] | null {
  if (!isRecord(value)) return null;
  return fields.map((f) => ({
    name: f.name,
    value: typeValue(value[f.name], f.lfType, self, lookup),
  }));
}
