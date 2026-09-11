// **Where the check runs — this code does not know whether the node is real or recorded.**
//
// The one line that diverges is `ask`. Running against a live node and running against a recorded one
// (`*.test.ts` in CI) both call **this same function**; the only difference is what sits behind `ask`. That
// makes "it passed locally but CI looked at something else" impossible.
//
// The check is a library, not a command: whoever runs it against a live node builds `ask` and holds the
// token. Keeping it here rather than beside that runner is deliberate — the CI suite has to import it, and
// it has to change in the same commit as the API it checks.
// ajv ships as CJS — this repo sets `verbatimModuleSyntax`, so a default import is typed as the whole module
// (at runtime the class arrives). Using the named export makes both sides agree.

import type { ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { openApiDocument } from "../openapi.ts";
import { type Harvest, harvest, ROUND_ONE, ROUND_TWO } from "./expectations.ts";

// The channel for asking one address as one person. Whoever built `ask` already holds the token — this keeps
// credentials out of this file, so there is no place for them to end up in a log or a report.
export type Ask = (url: string) => Promise<{ status: number; body: unknown }>;

export type CheckUser = { name: string; ask: Ask };

// **This check does not read a clock either.** The API requires the "now" for judging expiry as a query
// parameter (router.ts: "The 'now' for judging expiry is measured by the caller and passed in"). The real-node
// side passes `new Date()`; the CI side passes a fixed instant — that is what makes the answer to a recorded
// response the same every time.
export type Now = { iso: string; ms: number };
export const nowFrom = (at: Date): Now => ({ iso: at.toISOString(), ms: at.getTime() });

// What one address is and what counts as passing. The table itself is in expectations.ts.
export type EndpointSpec = {
  /** The openapi path template — the 200 schema is found by it. */
  template: string;
  /** The address actually asked. Round two returns null when round one yielded nothing, and that is a failure. */
  url: (harvested: Harvest, now: Now) => string | null;
  /** The name for the report. Distinguishes asking the same template twice (with pageSize, say). */
  name?: string;
  /** Returning null passes; returning a sentence makes that sentence the failure reason. */
  filled: (body: unknown) => string | null;
  /** What was missing, for when round two could not harvest its value. */
  need?: string;
};

export type Level = "responds" | "schema" | "filled";
export type Finding = { user: string; url: string; level: Level; message: string };

export type CheckReport = {
  users: string[];
  asked: number;
  findings: Finding[];
  ok: boolean;
};

// ── Comparing against the contract ───────────────────────────────────────────────
// The schemas in openapi 3.1 are JSON Schema 2020-12 — ajv's 2020 entry point is the one that means the same
// thing. Only `components.schemas` is added, not the whole document: `$ref` is `#/components/schemas/…`, so
// that shell is enough to resolve them, and ajv never sees non-JSON-Schema keywords such as `paths`.
const SCHEMAS_ID = "urn:canton-lens:responses";

// The operations openapi declares, as `"GET /api/session"`. **Operations, not paths** — a `post` added under
// an already-covered path used to slip past the coverage guard entirely, because both the validator map and the
// guard looked only at `item.get` and at the set of path strings.
// Everything here is GET today; enumerating operations is what keeps that from being an assumption.
const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "head", "options", "trace"] as const;

type Operation = { method: string; path: string; schemaRef: string | undefined };

function operations(): Operation[] {
  const found: Operation[] = [];
  for (const [path, item] of Object.entries(openApiDocument.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = (item as Record<string, unknown>)[method];
      if (operation === undefined) continue;
      const ok200 = (operation as { responses?: Record<string, unknown> }).responses?.["200"];
      const schemaRef = (
        ok200 as { content?: Record<string, { schema?: { $ref?: string } }> } | undefined
      )?.content?.["application/json"]?.schema?.$ref;
      found.push({ method: method.toUpperCase(), path, schemaRef });
    }
  }
  return found;
}

export const operationName = (method: string, path: string): string => `${method} ${path}`;

function schemaValidators(): Map<string, ValidateFunction> {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  ajv.addSchema({
    $id: SCHEMAS_ID,
    components: { schemas: openApiDocument.components.schemas },
  });
  const byOperation = new Map<string, ValidateFunction>();
  for (const { method, path, schemaRef } of operations()) {
    if (schemaRef === undefined) continue;
    const validate = ajv.getSchema(`${SCHEMAS_ID}${schemaRef}`);
    if (validate !== undefined) byOperation.set(operationName(method, path), validate);
  }
  return byOperation;
}

// ajv's error list is long. Only the first few go into the report — one is enough to see where the drift is,
// and carrying all of them makes a report nobody reads.
const ERRORS_SHOWN = 4;
const sayErrors = (validate: ValidateFunction): string => {
  const all = validate.errors ?? [];
  const shown = all
    .slice(0, ERRORS_SHOWN)
    .map((e) => `${e.instancePath || "(root)"} ${e.message ?? ""}`.trim())
    .join(" · ");
  return all.length > ERRORS_SHOWN ? `${shown} … (${all.length} in total)` : shown;
};

// What the check covers — a test looks at this. **It keeps two safety nets from quietly rotting**: an
// operation missing from the table is never asked, and a 200 schema that does not resolve means level ②
// compares nothing. Both are roads to "green while looking at nothing".
export function describeCoverage(): {
  /** Every operation openapi declares, as `"GET /api/session"`. */
  openApiOperations: string[];
  checkedOperations: string[];
  missingFromCheck: string[];
  withoutValidator: string[];
} {
  const validators = schemaValidators();
  const all = operations();
  // The check table only ever issues GET — that is what `ask` does.
  const covered = new Set(
    [...ROUND_ONE, ...ROUND_TWO].map((spec) => operationName("GET", spec.template)),
  );
  const names = all.map((o) => operationName(o.method, o.path));
  return {
    openApiOperations: names,
    checkedOperations: [...covered],
    missingFromCheck: names.filter((n) => !covered.has(n)),
    withoutValidator: names.filter((n) => !validators.has(n)),
  };
}

// ── Running ──────────────────────────────────────────────────────────────────────

export async function runCheck(users: readonly CheckUser[], now: Now): Promise<CheckReport> {
  const validators = schemaValidators();
  const findings: Finding[] = [];
  let asked = 0;

  // **The coverage guard — it stops a new operation from arriving unchecked.** Without it, an operation could
  // be added to openapi and the check would still be green, and "all 16 addresses are looked at" would quietly
  // become false. The table does not adjust itself to openapi; it is the other way round — the contract is the
  // source of truth.
  for (const name of describeCoverage().missingFromCheck) {
    findings.push({
      user: "(all)",
      url: name,
      level: "filled",
      message:
        "declared in openapi but absent from the check table (expectations.ts) — never asked",
    });
  }

  for (const user of users) {
    const bodies = new Map<string, unknown>();

    // The two rounds run in order. Round one's answers build round two's addresses.
    const round = async (specs: readonly EndpointSpec[], harvested: Harvest) => {
      for (const spec of specs) {
        const url = spec.url(harvested, now);
        const label = spec.name ?? spec.template;
        if (url === null) {
          // No address could be built — which means round one was empty. Skipping would make green a lie.
          findings.push({
            user: user.name,
            url: label,
            level: "filled",
            message: `could not be asked — ${spec.need ?? "no value could be harvested from the earlier responses"}`,
          });
          continue;
        }
        asked += 1;
        let status: number;
        let body: unknown;
        try {
          ({ status, body } = await user.ask(url));
        } catch (error) {
          findings.push({
            user: user.name,
            url,
            level: "responds",
            message: `threw — ${String((error as { message?: unknown })?.message ?? error)}`,
          });
          continue;
        }

        // ① It answers. Asked with a token, so it must be 200 — anything else records the circumstance.
        if (status !== 200) {
          const reason = (body as { reason?: unknown } | null)?.reason;
          findings.push({
            user: user.name,
            url,
            level: "responds",
            message: `${status}${typeof reason === "string" ? ` ${reason}` : ""}`,
          });
          continue;
        }
        bodies.set(url, body);

        // ② It matches the contract.
        const validate = validators.get(operationName("GET", spec.template));
        if (validate === undefined) {
          findings.push({
            user: user.name,
            url,
            level: "schema",
            message: `openapi has no 200 schema for ${spec.template}`,
          });
        } else if (!validate(body)) {
          findings.push({ user: user.name, url, level: "schema", message: sayErrors(validate) });
        }

        // ③ It has content. Checked even when ② failed — with both at once, looking at one misdiagnoses.
        const empty = spec.filled(body);
        if (empty !== null) {
          findings.push({ user: user.name, url, level: "filled", message: empty });
        }
      }
    };

    const NOTHING: Harvest = {
      contractId: null,
      updateId: null,
      offset: null,
      packageId: null,
      partyId: null,
    };
    await round(ROUND_ONE, NOTHING);
    await round(ROUND_TWO, harvest(bodies));
  }

  return {
    users: users.map((u) => u.name),
    asked,
    findings,
    ok: findings.length === 0,
  };
}

// The report as prose. It lives here so the real-node side and the CI side print the same thing.
export function formatReport(report: CheckReport): string {
  const lines: string[] = [];
  const perLevel = (level: Level) => report.findings.filter((f) => f.level === level).length;
  lines.push(
    `${report.users.length} people (${report.users.join("·")}) · asked ${report.asked} times · ` +
      `${report.findings.length} discrepancies` +
      (report.findings.length === 0
        ? ""
        : ` (answers ${perLevel("responds")} · contract ${perLevel("schema")} · content ${perLevel("filled")})`),
  );
  for (const f of report.findings) {
    const mark = { responds: "①", schema: "②", filled: "③" }[f.level];
    lines.push(`  ${mark} ${f.user} ${f.url} — ${f.message}`);
  }
  lines.push(report.ok ? "Passed — all three levels." : "Failed.");
  return lines.join("\n");
}
