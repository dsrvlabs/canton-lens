// dist/styles.css — inlines the @import chain of src/styles/index.css in place, into a single sheet.
// The artifact makes no assumption that the consumer's bundler resolves @import. No dependencies.
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const stylesDir = resolve(here, "../src/styles");
const dist = resolve(here, "../dist");

const IMPORT = /^@import\s+"(\.\/[^"]+)";\s*$/gm;

async function inline(file) {
  const src = await readFile(file, "utf8");
  const parts = [];
  let last = 0;
  for (const m of src.matchAll(IMPORT)) {
    parts.push(src.slice(last, m.index));
    parts.push(await inline(resolve(dirname(file), m[1])));
    last = m.index + m[0].length;
  }
  parts.push(src.slice(last));
  return parts.join("");
}

await mkdir(dist, { recursive: true });
const css = await inline(resolve(stylesDir, "index.css"));
await writeFile(resolve(dist, "styles.css"), css);
await copyFile(resolve(stylesDir, "tokens.css"), resolve(dist, "tokens.css"));
// No relative @import may remain. A package @import (pretendard) does — the consumer's bundler resolves it.
if (/^@import\s+"\.\//m.test(css)) throw new Error("dist/styles.css still carries a relative @import");
console.log("dist/styles.css", css.length, "bytes");
