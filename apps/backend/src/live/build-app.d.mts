// The types for `build-app.mjs`. That file is a boot site, so it is `.mjs` (executable code that uses no
// types), but something that does use types now imports it (check/run-check.test.ts), so its signature is
// written here. **The `.mjs` is the implementation and the source of truth; this file only describes it** —
// adding an argument there means fixing this too.
import type { FastifyInstance } from "fastify";
import type { LedgerSend } from "@canton-lens/core";
import type { openApiDocument } from "../openapi.ts";
import type { LedgerAuthConfig } from "../auth/config.ts";

export function buildApp(options: {
  /** The only channel out to the ledger. Required — it is what decides whether this app is attached to the real thing. */
  send: LedgerSend;
  ledgerAuth: LedgerAuthConfig;
  /** Test seams for service OAuth transport and expiry clock; production uses fetch/Date.now. */
  serviceTokenOptions?: { fetch?: typeof fetch; now?: () => number };
  /** The clock for the `readAt` stamped on 200 responses. The router does not call a clock. */
  now?: () => Date;
  /** For when the API is mounted under a sub-path such as `/explorer`. */
  basePath?: string;
  /** Optional public service entry shown when an unauthenticated browser reaches this internal server. */
  publicEntryUrl?: string;
  openApiDocument?: typeof openApiDocument;
}): FastifyInstance;
