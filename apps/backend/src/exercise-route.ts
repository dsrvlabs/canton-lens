// POST /api/exercise — the Explorer's only write. Its security design is docs/ledger-writes.md.
//
// The order of the checks below is the design, not a convenience: the gate comes before the token,
// the token before the body, and the body before anything reaches the participant. A deployment
// that has not opened writes must answer the same way whether or not the caller is authenticated
// and whether or not the command is well-formed, because a different answer per case tells an
// unauthenticated caller which deployments could be written to.

import type {
  LedgerCallResult,
  LedgerSend,
  PackageSchema,
  SchemaTemplate,
} from "@canton-lens/core";
import { buildExercise, callSubmitAndWait, findTemplate } from "@canton-lens/core";
import { ledgerFailureToHttp } from "./ledger-failure-to-http.ts";
import type { RouterRequest, RouterResponse } from "./router-types.ts";
import type { LedgerWriteConfig } from "./write-config.ts";

// The names ledgerFailureToHttp accepts. Kept here as a predicate because loadSchema's reason is a
// wider string — it also carries the decoder's own failures, which are not ledger answers.
function isLedgerReason(reason: string): boolean {
  return [
    "unauthenticated",
    "forbidden",
    "not_found",
    "node_error",
    "unreachable",
    "pruned",
  ].includes(reason);
}

// `<packageId>:<Module>:<Entity>`. The module part may itself contain dots but not colons, so the
// split is on the first and last colon rather than on every one.
function splitTemplateId(
  templateId: string,
): { packageId: string; module: string; name: string } | null {
  const first = templateId.indexOf(":");
  const last = templateId.lastIndexOf(":");
  if (first <= 0 || last <= first || last === templateId.length - 1) return null;
  return {
    packageId: templateId.slice(0, first),
    module: templateId.slice(first + 1, last),
    name: templateId.slice(last + 1),
  };
}

type ExerciseBody = {
  contractId: string;
  templateId: string;
  choice: string;
  argument: Record<string, unknown>;
  actAs: string[];
};

// The body arrives as parsed JSON of unknown shape. Every field is checked here rather than trusted,
// for the reason the router already states about query parameters: validation that sits inside a
// handler gets skipped depending on which path was taken.
function readBody(body: unknown): ExerciseBody | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const { contractId, templateId, choice, argument, actAs } = b;
  if (typeof contractId !== "string" || contractId === "") return null;
  if (typeof templateId !== "string" || templateId === "") return null;
  if (typeof choice !== "string" || choice === "") return null;
  if (typeof argument !== "object" || argument === null || Array.isArray(argument)) return null;
  if (!Array.isArray(actAs) || actAs.some((party) => typeof party !== "string")) return null;
  // Unknown keys are refused rather than ignored: a caller that sent `readAs` or `disclosedContracts`
  // is asking for something this route does not do, and silently dropping it would submit a command
  // that is not the one they described.
  for (const key of Object.keys(b)) {
    if (!["contractId", "templateId", "choice", "argument", "actAs"].includes(key)) return null;
  }
  return {
    contractId,
    templateId,
    choice,
    argument: argument as Record<string, unknown>,
    actAs: actAs as string[],
  };
}

export type ExerciseDeps = {
  send: LedgerSend;
  writes: LedgerWriteConfig;
  // The router owns the schema cache, so the lookup is handed in rather than reached for. It also
  // keeps this file testable without a participant.
  loadSchema: (
    send: LedgerSend,
    packageId: string,
  ) => Promise<{ status: "ok"; schema: PackageSchema } | { status: "unavailable"; reason: string }>;
  // A fresh command id per submission. Injected because it is the one value here that is not a
  // function of the input, and a test that cannot fix it cannot assert on the request.
  newCommandId: () => string;
};

export async function handleExercise(
  req: RouterRequest,
  deps: ExerciseDeps,
): Promise<RouterResponse> {
  // ① The gate, before anything else. Same answer for every caller and every body.
  if (deps.writes.writes !== "enabled") {
    return { status: 403, body: { reason: "writes_not_available" } };
  }
  // ② The token, on the same terms as every read route.
  if (req.ledgerToken === null) {
    return { status: 401, body: { reason: "unauthenticated" } };
  }
  // ③ The body.
  const parsed = readBody(req.body);
  if (parsed === null) return { status: 400, body: { reason: "invalid_body" } };

  const split = splitTemplateId(parsed.templateId);
  if (split === null) return { status: 400, body: { reason: "invalid_template_id" } };

  const source = await deps.loadSchema(deps.send, split.packageId);
  if (source.status !== "ok") {
    // The package could not be read — which for a write is a refusal, not a reason to submit an
    // unchecked command. A reason the ledger gave is relayed as that ledger failure; a reason the
    // decoder gave (`unsupported_lf_version`, `decode_failed`) is this server's inability to check
    // the argument, and answering 502 rather than submitting is the point of the whole file.
    return isLedgerReason(source.reason)
      ? ledgerFailureToHttp(source.reason as Parameters<typeof ledgerFailureToHttp>[0])
      : { status: 502, body: { reason: "schema_unavailable", detail: source.reason } };
  }
  const template: SchemaTemplate | null = findTemplate(source.schema, split.module, split.name);
  if (template === null) return { status: 404, body: { reason: "unknown_template" } };

  const built = buildExercise(
    {
      contractId: parsed.contractId,
      templateId: parsed.templateId,
      choice: parsed.choice,
      argument: parsed.argument,
      actAs: parsed.actAs,
    },
    template,
  );
  if (!built.ok) {
    return { status: 400, body: { reason: "invalid_argument", rejection: built.rejection } };
  }

  // ④ Only now is the participant asked to commit. userId is left to the node to fill in from the
  // token; see buildSubmitAndWaitRequest.
  const result: LedgerCallResult<{ updateId: string; completionOffset: number | null }> =
    await callSubmitAndWait(deps.send, built.command, parsed.actAs, deps.newCommandId(), null);
  if (!result.ok) return ledgerFailureToHttp(result.reason);
  return {
    status: 200,
    body: { updateId: result.value.updateId, completionOffset: result.value.completionOffset },
  };
}
