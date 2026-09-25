#!/usr/bin/env node
// Prints the CSP source expression for every inline <script> in a built index.html — the value
// `script-src` in docker/nginx.conf.template has to carry. One argument: the path of the HTML.
//
//   VITE_AUTH_MODE=shared-identity pnpm --filter @canton-lens/frontend build
//   node docker/inline-script-hashes.mjs apps/frontend/dist/index.html
//
// The hash covers the exact text between the tags, whitespace included, so it is taken from the
// built file rather than the source: that is the text the browser hashes. The CI docker job runs
// this against the file inside the frontend image and fails when the template says otherwise.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node docker/inline-script-hashes.mjs <index.html>");
  process.exit(2);
}
const html = readFileSync(path, "utf8");
// An inline script is one without a src attribute. The bundle's own <script src> needs no hash.
const inline = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let count = 0;
for (const match of html.matchAll(inline)) {
  count++;
  console.log(`'sha256-${createHash("sha256").update(match[1]).digest("base64")}'`);
}
if (count === 0) console.error("no inline script found");
