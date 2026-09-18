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
import { routeOperations } from "../routes.ts";
import { questionProblems } from "./asked-well.ts";
import { type Harvest, harvest, ROUND_ONE, ROUND_TWO } from "./expectations.ts";
import type { Given } from "./given.ts";
import { checkPages, differences } from "./mapping.ts";
import { MAPPINGS } from "./mappings/index.ts";
import { answerDifference, type Kind, PROBES, type ProbeMaterial, whyNoProbe } from "./probes.ts";
import type { NodeCall } from "./trace.ts";

// The channel for asking one address as one person. Whoever built `ask` already holds the token — this keeps
// credentials out of this file, so there is no place for them to end up in a log or a report.
// `ledger` is what the node was asked for this one address, in order. **The answer alone is not enough to
// judge most of the nine sentences**: "we said fifteen" can only be compared with what the node handed us, and
// that number is nowhere in the response. Whoever builds `ask` collects it (check/trace.ts).
export type Ask = (
  url: string,
) => Promise<{ status: number; body: unknown; ledger: readonly NodeCall[] }>;

// **Who is asking, and what they were given.** The second half is what lets an answer be judged as right *for
// this person*: a viewer holding no party is answered 403 everywhere that needs one, and that is the correct
// answer, not a failure. See check/given.ts for why it is declared rather than worked out.
export type CheckUser = {
  name: string;
  ask: Ask;
  given: Given;
  /**
   * The payload of this person's ledger token, already decoded by whoever holds the token — never the token
   * itself. `null` when it is not a JWT. See `CheckContext.callerToken`.
   */
  tokenPayload: Record<string, unknown> | null;
  /**
   * What this person can be probed with for axis ⑤ — a contract they cannot see, one that was archived, a
   * party they share nothing with. Worked out by asking the node directly, never from our own answers.
   */
  probes: ProbeMaterial;
};

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
  /** The address actually asked. Round two returns null when round one yielded nothing. */
  url: (harvested: Harvest, now: Now) => string | null;
  /** The name for the report. Distinguishes asking the same template twice (with pageSize, say). */
  name?: string;
  /** Returning null passes; returning a sentence makes that sentence the failure reason. */
  filled: (body: unknown, given: Given) => string | null;
  /** What was missing, for when round two could not harvest its value. */
  need?: string;
  /**
   * What this address must answer **this** person. Absent means 200. A viewer with no reading scope is
   * answered 403 no_party_rights on every party-scoped address, and that is the right answer — while for
   * anyone else the same 403 is a defect. It is judged both ways: the stated status is required, not merely
   * tolerated.
   */
  status?: (given: Given) => { status: number; reason?: string };
  /**
   * Why this address cannot be put to this person at all — null when it can. A round-two address is built
   * from a value harvested in round one, and when that value legitimately does not exist (nobody has no
   * contracts to name, a super reader has no party of their own) there is nothing to ask.
   *
   * **Both directions are judged.** A reason given while an address could still be built is as much a defect
   * as an address that could not be built without one: the first hides a question we stopped asking, the
   * second hides one we never could.
   */
  unaskable?: (given: Given) => string | null;
};

export type Level = "responds" | "schema" | "filled" | "mapping" | "sameness";
export type Finding = { user: string; url: string; level: Level; message: string };

/** An address that was rightly not put to someone, and why. Counted and printed, never silent. */
export type NotAsked = { user: string; url: string; why: string };

export type CheckReport = {
  users: string[];
  asked: number;
  findings: Finding[];
  /** The zeros that were legitimate. A zero with no reason is a finding instead. */
  notAsked: NotAsked[];
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
  /** Every operation the router answers, as `"GET /api/session"`. */
  routerOperations: string[];
  missingFromCheck: string[];
  withoutValidator: string[];
  /** Declared in openapi, not recognised by the router — the document promises an address that 404s. */
  missingFromRouter: string[];
  /** Answered by the router, absent from openapi — an address nobody agreed to and nothing describes. */
  undocumented: string[];
  /** In the check table, absent from openapi — the table asks for something nothing describes. */
  askedButUndocumented: string[];
} {
  const validators = schemaValidators();
  const all = operations();
  // The check table only ever issues GET — that is what `ask` does.
  const covered = new Set(
    [...ROUND_ONE, ...ROUND_TWO].map((spec) => operationName("GET", spec.template)),
  );
  const names = all.map((o) => operationName(o.method, o.path));
  // **Compared as operations, not as paths.** A method is half of what an address is: without it, a POST
  // added to the document could never be reported as missing from the router, because the router's side of
  // the comparison could not say what it answers.
  const documented = new Set(names);
  const answered = new Set(routeOperations());
  return {
    openApiOperations: names,
    checkedOperations: [...covered],
    routerOperations: [...answered],
    missingFromCheck: names.filter((n) => !covered.has(n)),
    withoutValidator: names.filter((n) => !validators.has(n)),
    missingFromRouter: [...documented].filter((n) => !answered.has(n)),
    undocumented: [...answered].filter((n) => !documented.has(n)),
    // The fourth direction. An entry in the table naming something openapi does not declare would otherwise
    // only show up as a failure when asked — and on a person who is not asked it, not at all.
    askedButUndocumented: [...covered].filter((n) => !documented.has(n)),
  };
}

// ── Running ──────────────────────────────────────────────────────────────────────

export async function runCheck(users: readonly CheckUser[], now: Now): Promise<CheckReport> {
  const validators = schemaValidators();
  const findings: Finding[] = [];
  const notAsked: NotAsked[] = [];
  let asked = 0;

  // **The three sets of addresses have to be one set.** The router answers some addresses, openapi declares
  // some, and the check table asks about some; "every address is looked at" is only true when those name the
  // same things. Each direction is a different failure and each is reported as itself:
  //
  //   openapi \ check     — an operation was added to the contract and nothing ever asks for it
  //   openapi \ router    — the document promises an address that answers 404
  //   router \ openapi    — the application answers at an address nothing describes and nothing checks
  //   check \ openapi     — the table asks for something nothing describes
  //
  // The contract stays the source of truth: neither the table nor the router adjusts itself to the others.
  const coverage = describeCoverage();
  for (const name of coverage.missingFromCheck) {
    findings.push({
      user: "(all)",
      url: name,
      level: "filled",
      message:
        "declared in openapi but absent from the check table (expectations.ts) — never asked",
    });
  }
  for (const path of coverage.missingFromRouter) {
    findings.push({
      user: "(all)",
      url: path,
      level: "filled",
      message: "declared in openapi but not an address the router answers (routes.ts) — it 404s",
    });
  }
  for (const path of coverage.undocumented) {
    findings.push({
      user: "(all)",
      url: path,
      level: "filled",
      message:
        "answered by the router (routes.ts) but absent from openapi — undocumented, unchecked",
    });
  }
  for (const name of coverage.askedButUndocumented) {
    findings.push({
      user: "(all)",
      url: name,
      level: "filled",
      message:
        "in the check table (expectations.ts) but absent from openapi — nothing describes it",
    });
  }

  // **What an address that belongs to nobody answered, and to whom.** Compared after everyone has been
  // asked: within one person nothing collapses on that path, so the claim only exists across people.
  const sharedAnswers = new Map<
    string,
    { user: string; answer: { status: number; body: unknown } }[]
  >();

  for (const user of users) {
    const bodies = new Map<string, unknown>();

    // The two rounds run in order. Round one's answers build round two's addresses.
    const round = async (specs: readonly EndpointSpec[], harvested: Harvest) => {
      for (const spec of specs) {
        const url = spec.url(harvested, now);
        const label = spec.name ?? spec.template;
        const unaskable = spec.unaskable?.(user.given) ?? null;
        if (url === null) {
          if (unaskable !== null) {
            // A zero with a stated reason. It is written down rather than skipped: an address nobody asks is
            // an address nobody checks, and the only thing keeping that honest is that it is visible.
            notAsked.push({ user: user.name, url: label, why: unaskable });
            continue;
          }
          // No address could be built and nothing says one could not be. Skipping would make green a lie.
          findings.push({
            user: user.name,
            url: label,
            level: "filled",
            message: `could not be asked — ${spec.need ?? "no value could be harvested from the earlier responses"}`,
          });
          continue;
        }
        if (unaskable !== null) {
          // The other direction. Something said this person could not be asked and an address was built all
          // the same — so either the reason is wrong or the value it said was missing is not.
          findings.push({
            user: user.name,
            url,
            level: "filled",
            message: `said to be unaskable (${unaskable}) and yet an address was built`,
          });
          continue;
        }
        asked += 1;
        let status: number;
        let body: unknown;
        let ledger: readonly NodeCall[];
        try {
          ({ status, body, ledger } = await user.ask(url));
        } catch (error) {
          findings.push({
            user: user.name,
            url,
            level: "responds",
            message: `threw — ${String((error as { message?: unknown })?.message ?? error)}`,
          });
          continue;
        }

        // ① It answers what it should answer this person. Usually 200; where the person holds no reading
        // scope the right answer is a refusal, and the refusal is **required**, not merely tolerated — a 200
        // where a 403 belongs is the more serious defect of the two.
        const want = spec.status?.(user.given) ?? { status: 200 };
        const reason = (body as { reason?: unknown } | null)?.reason;
        const said = `${status}${typeof reason === "string" ? ` ${reason}` : ""}`;
        if (status !== want.status || (want.reason !== undefined && reason !== want.reason)) {
          findings.push({
            user: user.name,
            url,
            level: "responds",
            message: `expected ${want.status}${want.reason === undefined ? "" : ` ${want.reason}`}, got ${said}`,
          });
          continue;
        }
        // A refusal that was the right answer is judged and done — there is no 200 schema to compare it with.
        if (want.status !== 200) continue;
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
        const empty = spec.filled(body, user.given);
        if (empty !== null) {
          findings.push({ user: user.name, url, level: "filled", message: empty });
        }

        // ④-a **The question was the right one.** Before judging what we did with the node's answer, judge
        // what we asked for: a request that names fewer parties than this person holds, or reads at some
        // other moment, or looks up some other update, produces a smaller or wrong answer that every
        // level below would then agree with perfectly. This runs for every address, mapped or not.
        for (const problem of questionProblems(url, ledger, user.given)) {
          findings.push({ user: user.name, url, level: "mapping", message: problem });
        }

        // ④ Every value in it came from somewhere. The rules for this address (check/mappings/) build the
        // answer again from what the node said, and the two are compared slot by slot. An address with no
        // rules is left at the first three levels rather than compared against nothing.
        const mapping = MAPPINGS[label];
        if (mapping !== undefined) {
          const expectation = mapping.expected({
            user: user.name,
            url,
            trace: ledger,
            now,
            callerToken: user.tokenPayload,
          });
          if (!expectation.ok) {
            findings.push({
              user: user.name,
              url,
              level: "mapping",
              message: `the expected answer could not be built — ${expectation.why}`,
            });
          } else {
            for (const problem of checkPages(expectation.body, expectation.pages ?? [])) {
              findings.push({ user: user.name, url, level: "mapping", message: problem });
            }
            for (const difference of differences(expectation.body, body)) {
              findings.push({ user: user.name, url, level: "mapping", message: difference });
            }
          }
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
    const harvested = harvest(bodies);
    await round(ROUND_TWO, harvested);

    // ⑤ **Naming something that is not mine must look like naming something that is not there.**
    // Judged between answers rather than against a rule, so it needs its own pass — nothing that looks at
    // one answer at a time can see a difference between two.
    for (const probe of PROBES) {
      const answers = new Map<Kind, { status: number; body: unknown }>();
      for (const kind of probe.kinds) {
        const url = probe.url(kind, harvested, user.probes);
        const label = `${probe.template} (${kind})`;
        if (url === null) {
          notAsked.push({
            user: user.name,
            url: label,
            why: whyNoProbe(kind, user.given),
          });
          continue;
        }
        asked += 1;
        const answer = await user.ask(url);
        answers.set(kind, { status: answer.status, body: answer.body });
        if (probe.sameForEveryone === true) {
          const at = sharedAnswers.get(url) ?? [];
          at.push({ user: user.name, answer: { status: answer.status, body: answer.body } });
          sharedAnswers.set(url, at);
        }
        const want = probe.says(kind, user.given);
        const said = (answer.body as { reason?: unknown; status?: unknown } | null) ?? {};
        if (answer.status !== want.status) {
          findings.push({
            user: user.name,
            url: label,
            level: "sameness",
            message: `expected ${want.status}, got ${answer.status}`,
          });
        }
        if (want.reason !== undefined && said.reason !== want.reason) {
          findings.push({
            user: user.name,
            url: label,
            level: "sameness",
            message: `expected the reason ${want.reason}, got ${String(said.reason)}`,
          });
        }
        if (want.bodySays !== undefined && said.status !== want.bodySays) {
          findings.push({
            user: user.name,
            url: label,
            level: "sameness",
            message: `expected the answer to say ${want.bodySays}, it said ${String(said.status)}`,
          });
        }
      }
      // The pairs that must not be told apart. A kind this person could not be asked drops out of the
      // comparison rather than making one up.
      const present = probe.identical.filter((kind) => answers.has(kind));
      const first = present[0];
      if (first === undefined) continue;
      for (const kind of present.slice(1)) {
        const difference = answerDifference(
          answers.get(first) as { status: number; body: unknown },
          answers.get(kind) as { status: number; body: unknown },
          probe.ignoring ?? [],
        );
        if (difference !== null) {
          findings.push({
            user: user.name,
            url: `${probe.template} (${first} against ${kind})`,
            level: "sameness",
            message: `these must not be told apart — ${difference}`,
          });
        }
      }
    }
  }

  // The cross-person claim. Grouped by the address itself, because two people who asked about two different
  // packages are not making one claim — only the same address twice is.
  for (const [url, asked2] of sharedAnswers) {
    const first = asked2[0];
    if (first === undefined) continue;
    for (const other of asked2.slice(1)) {
      const difference = answerDifference(first.answer, other.answer, []);
      if (difference !== null) {
        findings.push({
          user: `${first.user} and ${other.user}`,
          url,
          level: "sameness",
          message: `this belongs to nobody and must read the same to everyone — ${difference}`,
        });
      }
    }
  }

  return {
    users: users.map((u) => u.name),
    asked,
    findings,
    notAsked,
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
        : ` (answers ${perLevel("responds")} · contract ${perLevel("schema")} · content ${perLevel("filled")}` +
          ` · rules ${perLevel("mapping")} · sameness ${perLevel("sameness")})`),
  );
  for (const f of report.findings) {
    const mark = { responds: "①", schema: "②", filled: "③", mapping: "④", sameness: "⑤" }[f.level];
    lines.push(`  ${mark} ${f.user} ${f.url} — ${f.message}`);
  }
  for (const n of report.notAsked) lines.push(`  · ${n.user} ${n.url} — not asked: ${n.why}`);
  lines.push(report.ok ? "Passed — every level." : "Failed.");
  return lines.join("\n");
}
