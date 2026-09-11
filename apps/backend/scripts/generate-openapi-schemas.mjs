#!/usr/bin/env node
// **openapi response schema generator.** Extracts every type apps/backend/src/responses.ts exports as JSON schema
// and writes it to apps/backend/src/openapi-schemas.generated.ts. openapi.ts loads that file as components.schemas
// and points at it with $ref per path — the source of truth for response shapes is the single TypeScript type in core.
//
//   pnpm openapi:generate          re-extract and write
//   pnpm openapi:check             only checks that a fresh extraction equals what is committed (CI)
//
// The generator (ts-json-schema-generator) is a devDependency of this package only — packages/core's zero runtime dependencies stays as is.
// This script does nothing beyond reading and writing files and running the biome formatter (no network, no clock).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGenerator } from "ts-json-schema-generator";

const HERE = dirname(fileURLToPath(import.meta.url));
// Everything is package-relative (apps/backend), so this script does not care where the package sits in the repo.
const PACKAGE_ROOT = resolve(HERE, "..");
// biome reads biome.json from its cwd, and that file lives at the repository root.
const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..");
const SOURCE = join(PACKAGE_ROOT, "src", "responses.ts");
const OUTPUT = join(PACKAGE_ROOT, "src", "openapi-schemas.generated.ts");
const TSCONFIG = join(PACKAGE_ROOT, "tsconfig.json");

// OpenAPI's components.schemas keys are `^[a-zA-Z0-9.\-_]+$`. The generator names generic instances like
// `SearchSection<SearchUpdateHit>`, so those characters are mapped — `<` and `,` become `.` so the meaning survives.
function componentName(definitionName) {
  return definitionName
    .replace(/[<,]/g, ".")
    .replace(/[>"'\s]/g, "")
    .replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

function generate() {
  const generator = createGenerator({
    path: SOURCE,
    tsconfig: TSCONFIG,
    // Every type responses.ts exports is a root. The core types reachable from there are placed in definitions under their exported names.
    type: "*",
    expose: "export",
    topRef: true,
    // `/** */` is moved into description. `//` comments are not — core's explanatory comments belong to the code.
    jsDoc: "extended",
    // Type checking is tsc's job (pnpm typecheck) — it is not done twice here.
    skipTypeCheck: true,
    // A field not written in the response is a contract violation — left open, the check could not catch a field the router sneaked in.
    additionalProperties: false,
    sortProps: true,
    strictTuples: true,
    // $ref names are not URI-encoded — we rewrite them below.
    encodeRefs: false,
  });
  const schema = generator.createSchema("*");
  const definitions = schema.definitions ?? {};

  // definitions → components.schemas. Map the names to OpenAPI characters, and if they collide after mapping, stop (do not overwrite silently).
  const names = new Map();
  for (const definitionName of Object.keys(definitions)) {
    const name = componentName(definitionName);
    const taken = names.get(name);
    if (taken !== undefined && taken !== definitionName) {
      throw new Error(`component name collision: both ${taken} and ${definitionName} map to ${name}`);
    }
    names.set(name, definitionName);
  }
  const byDefinition = new Map([...names].map(([name, definitionName]) => [definitionName, name]));

  const rewriteRefs = (node) => {
    if (Array.isArray(node)) return node.map(rewriteRefs);
    if (node === null || typeof node !== "object") return node;
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string" && value.startsWith("#/definitions/")) {
        const definitionName = value.slice("#/definitions/".length);
        const name = byDefinition.get(definitionName);
        if (name === undefined) throw new Error(`$ref points at a definition that does not exist: ${definitionName}`);
        out.$ref = `#/components/schemas/${name}`;
      } else {
        out[key] = rewriteRefs(value);
      }
    }
    return out;
  };

  const components = {};
  for (const name of [...names.keys()].sort()) {
    components[name] = rewriteRefs(definitions[names.get(name)]);
  }
  return components;
}

function render(components) {
  const header = [
    "// **Generated file — do not edit by hand.** Extracted by `pnpm openapi:generate` from the types in apps/backend/src/responses.ts.",
    "// To change the shape, edit responses.ts (the fields the router adds) or the types in packages/core and re-extract.",
    "// CI's `pnpm openapi:check` verifies this file is up to date.",
    "",
    `export const responseSchemas = ${JSON.stringify(components, null, 2)};`,
    "",
  ];
  return header.join("\n");
}

// Pass it through biome once — so `pnpm lint` does not complain about the generated file, and check's comparison is character-exact.
function formatted(source) {
  const dir = mkdtempSync(join(tmpdir(), "openapi-schemas-"));
  try {
    const file = join(dir, "openapi-schemas.generated.ts");
    writeFileSync(file, source);
    execFileSync("pnpm", ["exec", "biome", "format", "--write", file], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "ignore", "inherit"],
    });
    return readFileSync(file, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const check = process.argv.includes("--check");
const next = formatted(render(generate()));

if (check) {
  let current = null;
  try {
    current = readFileSync(OUTPUT, "utf8");
  } catch {
    // The file does not exist — answered as "differs" below.
  }
  if (current !== next) {
    console.error(
      "openapi-schemas.generated.ts differs from responses.ts and the core types — run `pnpm openapi:generate` and commit.",
    );
    process.exit(1);
  }
  console.log("openapi-schemas.generated.ts is up to date.");
} else {
  writeFileSync(OUTPUT, next);
  console.log(`wrote: ${OUTPUT}`);
}
