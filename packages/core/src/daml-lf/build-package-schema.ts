// ArchivePayload bytes → the **package schema** the screen draws. This is the deliverable of reading the contract blueprint (decision: implement it ourselves, no SDK).
//
// Four screen landing points read this one thing: Choices and typed payload in Contracts detail, choice arguments in Transactions detail, name·version·table of
// contents in the Packages catalog, definitions in the Templates catalog. Failures are answered by name — if the schema cannot be read, the screen stays as it is now (Raw JSON·“not in this layer”).

import { readArchivePayload } from "./archive-payload.ts";
import {
  type LfChoice,
  type LfDataType,
  LfDecodeError,
  type LfType,
  type LfTypeConRef,
  readLf2Package,
} from "./lf2-package.ts";
import { typeHead, typeText } from "./type-text.ts";

export type SchemaField = { name: string; type: string; lfType: LfType };
export type SchemaChoice = {
  name: string;
  consuming: boolean;
  argType: string | null;
  // If the argument is a record in this package, the fields are expanded — so the screen sees the argument names directly.
  argFields: SchemaField[] | null;
  returnType: string | null;
};
export type SchemaRef = { module: string; name: string; packageId: string | null };
export type SchemaTemplate = {
  module: string;
  name: string;
  fields: SchemaField[];
  choices: SchemaChoice[];
  key: string | null;
  implements: SchemaRef[];
};
export type SchemaInterface = {
  module: string;
  name: string;
  view: string | null;
  methods: { name: string; type: string | null }[];
  choices: SchemaChoice[];
  requires: SchemaRef[];
};
export type SchemaDataType = {
  module: string;
  name: string;
  serializable: boolean;
  paramCount: number;
  cons:
    | { kind: "record"; fields: SchemaField[] }
    | { kind: "variant"; fields: SchemaField[] }
    | { kind: "enum"; constructors: string[] }
    | { kind: "interface" };
};
export type PackageSchema = {
  packageId: string | null;
  lfVersion: string;
  name: string | null;
  version: string | null;
  modules: {
    name: string;
    templates: SchemaTemplate[];
    interfaces: SchemaInterface[];
    dataTypes: SchemaDataType[];
  }[];
  counts: {
    templates: number;
    interfaces: number;
    dataTypes: number;
    internedStrings: number;
    internedTypes: number;
  };
};
export type BuildPackageSchemaResult =
  | { ok: true; schema: PackageSchema }
  | { ok: false; reason: string };

function consOf(d: LfDataType): SchemaDataType["cons"] {
  const field = (f: { name: string; type: LfType }): SchemaField => ({
    name: f.name,
    type: typeText(f.type),
    lfType: f.type,
  });
  switch (d.cons.kind) {
    case "record":
      return { kind: "record", fields: d.cons.fields.map(field) };
    case "variant":
      return { kind: "variant", fields: d.cons.fields.map(field) };
    case "enum":
      return { kind: "enum", constructors: d.cons.constructors };
    default:
      return { kind: "interface" };
  }
}

function ref(r: LfTypeConRef): SchemaRef {
  return {
    module: r.module,
    name: r.name,
    packageId: r.pkg.kind === "imported" ? r.pkg.packageId : null,
  };
}

export function buildPackageSchema(
  bytes: Uint8Array,
  packageId?: string,
): BuildPackageSchemaResult {
  const payload = readArchivePayload(bytes);
  if (!payload.ok) return payload;
  try {
    const pkg = readLf2Package(payload.lf2);
    // Look up records within this package by name (for expanding choice arguments) — only self references within the same package are resolved.
    const records = new Map<string, LfDataType>();
    for (const m of pkg.modules)
      for (const d of m.dataTypes)
        if (d.cons.kind === "record") records.set(`${m.name}:${d.name}`, d);
    const field = (f: { name: string; type: LfType }): SchemaField => ({
      name: f.name,
      type: typeText(f.type),
      lfType: f.type,
    });
    const choice = (c: LfChoice): SchemaChoice => {
      let argFields: SchemaField[] | null = null;
      if (c.argType !== null) {
        const head = typeHead(c.argType);
        if (head.kind === "con" && head.pkg.kind === "self") {
          const rec = records.get(`${head.module}:${head.name}`);
          if (rec !== undefined && rec.cons.kind === "record")
            argFields = rec.cons.fields.map(field);
        }
      }
      return {
        name: c.name,
        consuming: c.consuming,
        argType: c.argType === null ? null : typeText(c.argType),
        argFields,
        returnType: c.returnType === null ? null : typeText(c.returnType),
      };
    };
    let templates = 0;
    let interfaces = 0;
    let dataTypes = 0;
    const modules = pkg.modules.map((m) => {
      templates += m.templates.length;
      interfaces += m.interfaces.length;
      dataTypes += m.dataTypes.length;
      return {
        name: m.name,
        templates: m.templates.map((t) => {
          // A template's fields live in the record data type of the same name (Daml: template = record + choices).
          const rec = records.get(`${m.name}:${t.name}`);
          return {
            module: m.name,
            name: t.name,
            fields:
              rec !== undefined && rec.cons.kind === "record" ? rec.cons.fields.map(field) : [],
            choices: t.choices.map(choice),
            key: t.keyType === null ? null : typeText(t.keyType),
            implements: t.implements.map(ref),
          };
        }),
        interfaces: m.interfaces.map((i) => ({
          module: m.name,
          name: i.name,
          view: i.view === null ? null : typeText(i.view),
          methods: i.methods.map((x) => ({
            name: x.name,
            type: x.type === null ? null : typeText(x.type),
          })),
          choices: i.choices.map(choice),
          requires: i.requires.map(ref),
        })),
        dataTypes: m.dataTypes.map((d) => ({
          module: m.name,
          name: d.name,
          serializable: d.serializable,
          paramCount: d.paramCount,
          cons: consOf(d),
        })),
      };
    });
    return {
      ok: true,
      schema: {
        packageId: packageId ?? null,
        lfVersion: payload.lfVersion,
        name: pkg.name,
        version: pkg.version,
        modules,
        counts: {
          templates,
          interfaces,
          dataTypes,
          internedStrings: pkg.internedStringCount,
          internedTypes: pkg.internedTypeCount,
        },
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof LfDecodeError
          ? error.reason
          : `decode_failed:${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// A single template within the schema — by the templateId's module:entity.
export function findTemplate(
  schema: PackageSchema,
  module: string,
  name: string,
): SchemaTemplate | null {
  for (const m of schema.modules)
    if (m.name === module) return m.templates.find((t) => t.name === name) ?? null;
  return null;
}
export function findInterface(
  schema: PackageSchema,
  module: string,
  name: string,
): SchemaInterface | null {
  for (const m of schema.modules)
    if (m.name === module) return m.interfaces.find((i) => i.name === name) ?? null;
  return null;
}
export function findDataType(
  schema: PackageSchema,
  module: string,
  name: string,
): SchemaDataType | null {
  for (const m of schema.modules)
    if (m.name === module) return m.dataTypes.find((d) => d.name === name) ?? null;
  return null;
}
