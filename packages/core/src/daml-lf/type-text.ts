// LfType → human-readable type notation. This is notation, not value transformation — it follows the conventions of Daml source.
//   Numeric 10 · Optional Text · [Party](List) · ContractId Holding · TextMap Int64 · GenMap Text Int64
//   Types from other packages are `Module:Name@first 8 chars of pkg`. TApp is written out as an application — in real data `Numeric 10` arrives as TApp(Builtin NUMERIC, nat 10).
//   Syn·Forall·Struct are `(synonym …)`·`(forall)`·`(struct …)` — it is normal for them not to appear in the surface render, and if they do, nothing is invented.

import type { LfType, PackageRef } from "./lf2-package.ts";

function pkgSuffix(pkg: PackageRef): string {
  if (pkg.kind === "self") return "";
  if (pkg.kind === "imported") return `@${pkg.packageId.slice(0, 8)}`;
  return `@import#${pkg.index}`;
}

function paren(s: string, needed: boolean): string {
  return needed ? `(${s})` : s;
}

// Flattens the application form TApp(TApp(Numeric, nat) …) into (head, arguments).
function flattenApp(t: LfType): { head: LfType; args: LfType[] } {
  if (t.kind !== "app") return { head: t, args: [] };
  const inner = flattenApp(t.lhs);
  return { head: inner.head, args: [...inner.args, t.rhs] };
}

export function typeText(t: LfType, nested = false): string {
  switch (t.kind) {
    case "nat":
      return String(t.n);
    case "var":
      return t.args.length === 0
        ? t.name
        : paren(`${t.name} ${t.args.map((a) => typeText(a, true)).join(" ")}`, nested);
    case "con": {
      const head = `${t.module}:${t.name}${pkgSuffix(t.pkg)}`;
      return t.args.length === 0
        ? head
        : paren(`${head} ${t.args.map((a) => typeText(a, true)).join(" ")}`, nested);
    }
    case "builtin": {
      if (t.name === "List" && t.args.length === 1) return `[${typeText(t.args[0] as LfType)}]`;
      if (t.args.length === 0) return t.name;
      return paren(`${t.name} ${t.args.map((a) => typeText(a, true)).join(" ")}`, nested);
    }
    case "app": {
      const { head, args } = flattenApp(t);
      const headText =
        head.kind === "builtin" || head.kind === "con" || head.kind === "var"
          ? typeText({ ...head, args: [] } as LfType, true)
          : typeText(head, true);
      const all = [
        ...(head.kind === "builtin" || head.kind === "con" || head.kind === "var" ? head.args : []),
        ...args,
      ];
      if (head.kind === "builtin" && head.name === "List" && all.length === 1)
        return `[${typeText(all[0] as LfType)}]`;
      return paren(`${headText} ${all.map((a) => typeText(a, true)).join(" ")}`, nested);
    }
    case "syn":
      return paren(
        `synonym ${t.module}:${t.name}${t.args.length ? ` ${t.args.map((a) => typeText(a, true)).join(" ")}` : ""}`,
        true,
      );
    case "forall":
      return "(forall)";
    case "struct":
      return `(struct ${t.fields.map((f) => `${f.name}: ${typeText(f.type)}`).join(", ")})`;
    default: {
      const exhaustive: never = t;
      return String(exhaustive);
    }
  }
}

// The “head” used by the value render — after resolving TApp·interned, what it is and with which arguments.
export type TypeHead =
  | { kind: "builtin"; name: string; args: LfType[] }
  | { kind: "con"; pkg: PackageRef; module: string; name: string; args: LfType[] }
  | { kind: "other"; text: string };

export function typeHead(t: LfType): TypeHead {
  const { head, args } = flattenApp(t);
  if (head.kind === "builtin")
    return { kind: "builtin", name: head.name, args: [...head.args, ...args] };
  if (head.kind === "con")
    return {
      kind: "con",
      pkg: head.pkg,
      module: head.module,
      name: head.name,
      args: [...head.args, ...args],
    };
  return { kind: "other", text: typeText(t) };
}
