// The Template catalog (screen 6) aggregates the layer 1 active contracts response by full templateId.
// This function makes no visibility judgment:
// here the input is already a response the participant has finished filtering server-side
// based on the requester's token, so judging again here would be a double judgment,
// making the same decision in two places. Stakeholder distinctions such as divulged_only are structurally absent
// from this layer's (createdEvent) response — they exist only in the __contracts column and cannot be obtained here.
//
// Values arriving via interfaceViews do not produce rows: this is not filtering them out but
// an absence-of-access-path approach, where that field is never placed on the traversal path in the first place.

import { parseTemplateFqn } from "../template-identifier/parse-template-identifier.ts";
import type { BuildTemplateCatalogResult, LiveTemplateCatalogRow } from "./types.ts";

export function buildTemplateCatalog(createdEvents: unknown): BuildTemplateCatalogResult {
  if (!Array.isArray(createdEvents)) {
    return { ok: false, reason: "invalid_shape:not_an_array" };
  }

  const byContractId = new Map<string, { templateId: string; packageName: string }>();

  for (const event of createdEvents) {
    if (event === null || typeof event !== "object") {
      return { ok: false, reason: "invalid_shape:not_an_object" };
    }
    const record = event as Record<string, unknown>;
    for (const field of ["contractId", "templateId", "packageName"] as const) {
      if (typeof record[field] !== "string") {
        return { ok: false, reason: `invalid_shape:missing_created_event_field:${field}` };
      }
    }
    const contractId = record.contractId as string;
    const templateId = record.templateId as string;
    const packageName = record.packageName as string;
    byContractId.set(contractId, { templateId, packageName });
  }

  const byTemplateId = new Map<
    string,
    {
      templateId: string;
      packageId: string;
      packageName: string;
      module: string;
      entity: string;
      count: number;
    }
  >();

  for (const { templateId, packageName } of byContractId.values()) {
    const parsed = parseTemplateFqn(templateId);
    if (!parsed.ok) {
      return { ok: false, reason: `invalid_shape:unparseable_template_id:${parsed.reason}` };
    }
    const existing = byTemplateId.get(templateId);
    if (existing) {
      existing.count += 1;
    } else {
      byTemplateId.set(templateId, {
        templateId,
        packageId: parsed.package_name,
        packageName,
        module: parsed.module_name,
        entity: parsed.entity_name,
        count: 1,
      });
    }
  }

  const rows: LiveTemplateCatalogRow[] = Array.from(byTemplateId.values())
    .map((entry) => ({
      templateId: entry.templateId,
      packageId: entry.packageId,
      packageName: entry.packageName,
      module: entry.module,
      entity: entry.entity,
      contractCount: entry.count,
    }))
    .sort((a, b) => {
      if (b.contractCount !== a.contractCount) {
        return b.contractCount - a.contractCount;
      }
      return a.templateId < b.templateId ? -1 : a.templateId > b.templateId ? 1 : 0;
    });

  return { ok: true, scope: "visible_to_requester", rows };
}
