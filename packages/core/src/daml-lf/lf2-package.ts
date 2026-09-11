// Reads only the **surface** of a Daml-LF 2.x package (design decision: template list·choices·field names/types·interfaces).
// The Expr world (values·precond·signatories·controllers·update·key expressions…) is skipped by reading only its length — we never step inside the message.
//
// Field numbers are exactly as in the canonical daml_lf2.proto (digital-asset/canton, community/daml-lf/archive):
//   Package{modules=1, interned_strings=2, interned_dotted_names=3, metadata=4, interned_types=5}
//   PackageMetadata{name_interned_str=1, version_interned_str=2}
//   Module{name_interned_dname=1, data_types=4, templates=6, interfaces=8}
//   DefDataType{name_interned_dname=2, params=3, serializable=4, record=5|variant=6|enum=7|interface=8}  Fields{fields=1}  EnumConstructors{constructors_interned_str=2}
//   FieldWithType{type=2, field_interned_str=3}  VarWithType{type=2, var_interned_str=3}  TypeVarWithKind{var_interned_str=?}(name only → params is used only for its count)
//   DefTemplate{tycon_interned_dname=1, choices=6, key=9, implements=10}  DefKey{type=1}  Implements{interface=1}
//   TemplateChoice{name_interned_str=2, consuming=3, arg_binder=6, ret_type=8}
//   DefInterface{tycon_interned_dname=2, methods=3, choices=5, view=6, requires=7}  InterfaceMethod{method_interned_name=2, type=3}
//   Type{var=1, con=2, builtin=3, forall=4, struct=5, nat=6(sint64), syn=7, interned_type=8, tapp=9}
//   Type.Var{var_interned_str=3, args=2}  Type.Con{tycon=1, args=2}  Type.Builtin{builtin=1, args=2}  Type.TApp{lhs=1, rhs=2}
//   TypeConId{module=1, name_interned_dname=2}  ModuleId{package_id=1, module_name_interned_dname=2}
//   SelfOrImportedPackageId{self_package_id=1, imported_package_id_interned_str=3, package_import_id=4}
//
// The three interning tables (strings·dotted names·types) are referenced by index. Out of range cuts off with a failure name — an empty name is never invented.

import {
  boolOr,
  bytesAll,
  bytesOf,
  hasField,
  LfDecodeError,
  MAX_DEPTH,
  readMessage,
  repeatedVarints,
  sint64Or,
  varintOr,
  type WireField,
} from "./protobuf-reader.ts";

export type PackageRef =
  | { kind: "self" }
  | { kind: "imported"; packageId: string }
  // A 2.dev package_imports index — outside the surface scope, so only the index is kept.
  | { kind: "import_index"; index: number };

export type BuiltinName =
  | "Unit"
  | "Bool"
  | "Int64"
  | "Date"
  | "Timestamp"
  | "Numeric"
  | "Party"
  | "Text"
  | "ContractId"
  | "Optional"
  | "List"
  | "GenMap"
  | "Any"
  | "AnyException"
  | "TypeRep"
  | "Arrow"
  | "Update"
  | "FailureCategory"
  | "TextMap"
  | "BigNumeric"
  | "RoundingMode";

export type LfType =
  | { kind: "builtin"; name: BuiltinName; args: LfType[] }
  | { kind: "con"; pkg: PackageRef; module: string; name: string; args: LfType[] }
  | { kind: "var"; name: string; args: LfType[] }
  | { kind: "nat"; n: number }
  | { kind: "syn"; module: string; name: string; args: LfType[] }
  | { kind: "forall" }
  | { kind: "struct"; fields: LfField[] }
  | { kind: "app"; lhs: LfType; rhs: LfType };

export type LfField = { name: string; type: LfType };

export type LfDataType = {
  name: string;
  paramCount: number;
  serializable: boolean;
  cons:
    | { kind: "record"; fields: LfField[] }
    | { kind: "variant"; fields: LfField[] }
    | { kind: "enum"; constructors: string[] }
    | { kind: "interface" };
};

export type LfChoice = {
  name: string;
  consuming: boolean;
  argType: LfType | null;
  returnType: LfType | null;
};

export type LfTypeConRef = { pkg: PackageRef; module: string; name: string };

export type LfTemplate = {
  name: string;
  choices: LfChoice[];
  keyType: LfType | null;
  implements: LfTypeConRef[];
};

export type LfInterface = {
  name: string;
  view: LfType | null;
  methods: { name: string; type: LfType | null }[];
  choices: LfChoice[];
  requires: LfTypeConRef[];
};

export type LfModule = {
  name: string;
  dataTypes: LfDataType[];
  templates: LfTemplate[];
  interfaces: LfInterface[];
};

export type Lf2Package = {
  name: string | null;
  version: string | null;
  modules: LfModule[];
  internedStringCount: number;
  internedDottedNameCount: number;
  internedTypeCount: number;
};

const BUILTINS: Record<number, BuiltinName> = {
  0: "Unit",
  1: "Bool",
  2: "Int64",
  3: "Date",
  4: "Timestamp",
  5: "Numeric",
  6: "Party",
  7: "Text",
  8: "ContractId",
  9: "Optional",
  10: "List",
  11: "GenMap",
  13: "Any",
  14: "AnyException",
  15: "TypeRep",
  16: "Arrow",
  17: "Update",
  18: "FailureCategory",
  19: "TextMap",
  1002: "BigNumeric",
  1003: "RoundingMode",
};

class Interning {
  readonly strings: string[];
  readonly dottedNames: string[];
  readonly typeBytes: Uint8Array[];
  // Package.package_imports(9).imported_packages(1) — the proto comment says 2.dev, but the real LF 2.2 from SDK 3.4 uses package_import_id(4) in
  // SelfOrImportedPackageId (probe: the interface reference in TransferOffer implements). If present, the index is resolved to a package id.
  readonly imports: string[];
  private readonly typeCache = new Map<number, LfType>();

  constructor(pkg: readonly WireField[]) {
    const utf8 = new TextDecoder("utf-8", { fatal: true });
    this.strings = bytesAll(pkg, 2).map((b) => {
      try {
        return utf8.decode(b);
      } catch {
        throw new LfDecodeError("interned_string_invalid_utf8");
      }
    });
    // Pitfall ②: segments is a packed varint.
    this.dottedNames = bytesAll(pkg, 3).map((b) =>
      repeatedVarints(readMessage(b, 1), 1)
        .map((i) => this.string(i))
        .join("."),
    );
    this.typeBytes = bytesAll(pkg, 5);
    const importsBytes = bytesOf(pkg, 9);
    this.imports =
      importsBytes === null
        ? []
        : bytesAll(readMessage(importsBytes, 1), 1).map((b) => {
            try {
              return utf8.decode(b);
            } catch {
              throw new LfDecodeError("package_import_invalid_utf8");
            }
          });
  }

  importedPackage(index: number): PackageRef {
    const id = this.imports[index];
    return id === undefined ? { kind: "import_index", index } : { kind: "imported", packageId: id };
  }

  string(index: number): string {
    const s = this.strings[index];
    if (s === undefined) throw new LfDecodeError(`interned_string_out_of_range:${index}`);
    return s;
  }

  dottedName(index: number): string {
    const s = this.dottedNames[index];
    if (s === undefined) throw new LfDecodeError(`interned_dotted_name_out_of_range:${index}`);
    return s;
  }

  internedType(index: number, depth: number): LfType {
    const cached = this.typeCache.get(index);
    if (cached !== undefined) return cached;
    const b = this.typeBytes[index];
    if (b === undefined) throw new LfDecodeError(`interned_type_out_of_range:${index}`);
    const t = readType(b, this, depth + 1);
    this.typeCache.set(index, t);
    return t;
  }
}

function readPackageRef(bytes: Uint8Array | null, it: Interning): PackageRef {
  if (bytes === null) return { kind: "self" }; // Default omission (pitfall ①) — self_package_id is Unit, so it can arrive as an empty message
  const f = readMessage(bytes, 1);
  if (hasField(f, 3)) return { kind: "imported", packageId: it.string(varintOr(f, 3, 0)) };
  if (hasField(f, 4)) return it.importedPackage(varintOr(f, 4, 0));
  return { kind: "self" };
}

function readTypeConRef(bytes: Uint8Array | null, it: Interning): LfTypeConRef {
  const f = bytes === null ? [] : readMessage(bytes, 1);
  const moduleBytes = bytesOf(f, 1);
  const m = moduleBytes === null ? [] : readMessage(moduleBytes, 1);
  return {
    pkg: readPackageRef(bytesOf(m, 1), it),
    module: it.dottedName(varintOr(m, 2, 0)),
    name: it.dottedName(varintOr(f, 2, 0)),
  };
}

function readTypeArgs(
  f: readonly WireField[],
  number: number,
  it: Interning,
  depth: number,
): LfType[] {
  return bytesAll(f, number).map((b) => readType(b, it, depth + 1));
}

export function readType(bytes: Uint8Array, it: Interning, depth: number): LfType {
  if (depth > MAX_DEPTH) throw new LfDecodeError("depth_exceeded");
  const f = readMessage(bytes, depth);
  if (hasField(f, 8)) return it.internedType(varintOr(f, 8, 0), depth);
  const builtin = bytesOf(f, 3);
  if (builtin !== null) {
    const b = readMessage(builtin, depth + 1);
    const code = varintOr(b, 1, 0);
    const name = BUILTINS[code];
    if (name === undefined) throw new LfDecodeError(`unknown_builtin_type:${code}`);
    return { kind: "builtin", name, args: readTypeArgs(b, 2, it, depth) };
  }
  const con = bytesOf(f, 2);
  if (con !== null) {
    const c = readMessage(con, depth + 1);
    const ref = readTypeConRef(bytesOf(c, 1), it);
    return { kind: "con", ...ref, args: readTypeArgs(c, 2, it, depth) };
  }
  const v = bytesOf(f, 1);
  if (v !== null) {
    const vf = readMessage(v, depth + 1);
    return {
      kind: "var",
      name: it.string(varintOr(vf, 3, 0)),
      args: readTypeArgs(vf, 2, it, depth),
    };
  }
  if (hasField(f, 6)) return { kind: "nat", n: sint64Or(f, 6, 0) };
  const syn = bytesOf(f, 7);
  if (syn !== null) {
    const s = readMessage(syn, depth + 1);
    const ref = readTypeConRef(bytesOf(s, 1), it);
    return { kind: "syn", module: ref.module, name: ref.name, args: readTypeArgs(s, 2, it, depth) };
  }
  const tapp = bytesOf(f, 9);
  if (tapp !== null) {
    const t = readMessage(tapp, depth + 1);
    const lhs = bytesOf(t, 1);
    const rhs = bytesOf(t, 2);
    if (lhs === null || rhs === null) throw new LfDecodeError("tapp_without_sides");
    return { kind: "app", lhs: readType(lhs, it, depth + 1), rhs: readType(rhs, it, depth + 1) };
  }
  const struct = bytesOf(f, 5);
  if (struct !== null) {
    return { kind: "struct", fields: readFields(readMessage(struct, depth + 1), it, depth) };
  }
  if (hasField(f, 4)) return { kind: "forall" };
  // oneof not set — under the default-omission rule Var{var=0,args=[]} also arrives as an empty message. This actually occurs in real data.
  return { kind: "var", name: it.string(0), args: [] };
}

// FieldWithType list (Fields.fields=1 · Struct.fields=1)
function readFields(container: readonly WireField[], it: Interning, depth: number): LfField[] {
  return bytesAll(container, 1).map((b) => {
    const f = readMessage(b, depth + 1);
    const t = bytesOf(f, 2);
    return {
      name: it.string(varintOr(f, 3, 0)),
      type: t === null ? { kind: "var", name: it.string(0), args: [] } : readType(t, it, depth + 1),
    };
  });
}

function readOptionalType(
  fields: readonly WireField[],
  number: number,
  it: Interning,
): LfType | null {
  const b = bytesOf(fields, number);
  return b === null ? null : readType(b, it, 1);
}

function readChoice(bytes: Uint8Array, it: Interning): LfChoice {
  const f = readMessage(bytes, 1);
  const arg = bytesOf(f, 6);
  const argFields = arg === null ? null : readMessage(arg, 2);
  return {
    name: it.string(varintOr(f, 2, 0)),
    consuming: boolOr(f, 3, false),
    argType: argFields === null ? null : readOptionalType(argFields, 2, it),
    returnType: readOptionalType(f, 8, it),
  };
}

function readDataType(bytes: Uint8Array, it: Interning): LfDataType {
  const f = readMessage(bytes, 1);
  const name = it.dottedName(varintOr(f, 2, 0));
  const paramCount = bytesAll(f, 3).length;
  const serializable = boolOr(f, 4, false);
  const record = bytesOf(f, 5);
  const variant = bytesOf(f, 6);
  const enumCons = bytesOf(f, 7);
  if (record !== null)
    return {
      name,
      paramCount,
      serializable,
      cons: { kind: "record", fields: readFields(readMessage(record, 2), it, 2) },
    };
  if (variant !== null)
    return {
      name,
      paramCount,
      serializable,
      cons: { kind: "variant", fields: readFields(readMessage(variant, 2), it, 2) },
    };
  if (enumCons !== null) {
    return {
      name,
      paramCount,
      serializable,
      cons: {
        kind: "enum",
        constructors: repeatedVarints(readMessage(enumCons, 2), 2).map((i) => it.string(i)),
      },
    };
  }
  if (hasField(f, 8)) return { name, paramCount, serializable, cons: { kind: "interface" } };
  throw new LfDecodeError(`data_type_without_constructors:${name}`);
}

function readTemplate(bytes: Uint8Array, it: Interning): LfTemplate {
  const f = readMessage(bytes, 1);
  const key = bytesOf(f, 9);
  return {
    name: it.dottedName(varintOr(f, 1, 0)),
    choices: bytesAll(f, 6).map((b) => readChoice(b, it)),
    keyType: key === null ? null : readOptionalType(readMessage(key, 2), 1, it),
    implements: bytesAll(f, 10).map((b) => readTypeConRef(bytesOf(readMessage(b, 2), 1), it)),
  };
}

function readInterface(bytes: Uint8Array, it: Interning): LfInterface {
  const f = readMessage(bytes, 1);
  return {
    name: it.dottedName(varintOr(f, 2, 0)),
    view: readOptionalType(f, 6, it),
    methods: bytesAll(f, 3).map((b) => {
      const m = readMessage(b, 2);
      return { name: it.string(varintOr(m, 2, 0)), type: readOptionalType(m, 3, it) };
    }),
    choices: bytesAll(f, 5).map((b) => readChoice(b, it)),
    requires: bytesAll(f, 7).map((b) => readTypeConRef(b, it)),
  };
}

export function readLf2Package(lf2: Uint8Array): Lf2Package {
  const pkg = readMessage(lf2);
  const it = new Interning(pkg);
  const metaBytes = bytesOf(pkg, 4);
  const meta = metaBytes === null ? null : readMessage(metaBytes, 1);
  const modules = bytesAll(pkg, 1).map((mb) => {
    const m = readMessage(mb, 1);
    return {
      name: it.dottedName(varintOr(m, 1, 0)),
      dataTypes: bytesAll(m, 4).map((b) => readDataType(b, it)),
      templates: bytesAll(m, 6).map((b) => readTemplate(b, it)),
      interfaces: bytesAll(m, 8).map((b) => readInterface(b, it)),
    };
  });
  // Module's values(5)·exceptions(7)·synonyms(3)·flags(2) are not read — they are the Expr world or outside the surface.
  return {
    name: meta === null ? null : it.string(varintOr(meta, 1, 0)),
    version: meta === null ? null : it.string(varintOr(meta, 2, 0)),
    modules,
    internedStringCount: it.strings.length,
    internedDottedNameCount: it.dottedNames.length,
    internedTypeCount: it.typeBytes.length,
  };
}

export { LfDecodeError };
