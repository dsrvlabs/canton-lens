// Where the preview's **judgment** alone is gathered — it turns the search response the server gave into the
// rows that will stand on screen, and sifts out input not worth asking about.
//
// Why it is split off from the component (SearchPreview.tsx): these two are the parts that rot quietly. When
// the response's shape changes, a row disappears without a sound or attaches to the wrong place, and the
// screen still looks fine. Kept as pure functions, tests hold that ground.
// Drawing and wiring (debounce, focus, keyboard) stay in the component.
import { said } from "../api/said.ts";
import type { SearchResponse } from "../api/types.ts";
import { href } from "../route/hash.ts";

// One row. The key includes the destination — two templates with the same name can differ only in package
// version, and both go to the same destination (#/contracts?template=Module:Entity). In the preview they are
// then two indistinguishable rows, so they fold into one.
export type Hit = { key: string; group: string; label: string; detail: string; to: string };

// How many rows the preview shows on one panel. More than this and the panel covers the screen — and going
// on to "View all results" is faster anyway.
export const MAX_HITS = 8;

// Whether an id is only half typed. That is "a long run of hex that classifySearchInput does not recognize
// as any complete id".
// The original of the three complete lengths is core/search/classify-search-input.ts
// (package 64 · update 68 · contract 138).
// They are copied here not to redo that judgment in the browser, but **to know when not to ask**.
const HEX_RUN = /^[0-9a-f]{8,}$/i;
const COMPLETE_ID_LENGTHS = new Set([64, 68, 138]);
export const worthAsking = (q: string): boolean =>
  !HEX_RUN.test(q) || COMPLETE_ID_LENGTHS.has(q.length);

// A failed section is named — never lumped into "some of it could not be fetched" (a partial failure is not
// hidden).
const SECTION_NAME: Record<string, string> = {
  updates: "Updates",
  contracts: "Contracts",
  parties: "Parties",
  templates: "Templates",
  packages: "Packages",
};

export function hitsOf(response: SearchResponse): Hit[] {
  const r = response.results;
  const hits: Hit[] = [];
  const push = (group: string, label: string, detail: string, to: string) =>
    hits.push({ key: `${group}:${to}`, group, label, detail, to });

  if (r.updates.status === "ok")
    // The server tells us the kind — not only transactions arrive (reassignments and so on). Writing
    // "Transaction" on all of them would be a lie.
    for (const row of r.updates.rows)
      push(
        "Updates",
        row.updateId,
        `Offset ${row.offset ?? "–"} · ${row.kind}`,
        href.tx(row.updateId),
      );
  if (r.contracts.status === "ok")
    for (const row of r.contracts.rows)
      push("Contracts", row.contractId, row.entity, href.contract(row.contractId));
  if (r.parties.status === "ok")
    for (const row of r.parties.rows)
      push("Parties", row.party, `${row.contractCount} shared contracts`, href.party(row.party));
  if (r.templates.status === "ok")
    for (const row of r.templates.rows)
      push(
        "Templates",
        `${row.module}:${row.entity}`,
        row.packageName,
        href.contractsOfTemplate(row.module, row.entity),
      );
  if (r.packages.status === "ok")
    for (const row of r.packages.rows)
      push("Packages", row.name ?? row.packageId, row.packageId, href.search(row.packageId));

  const seen = new Set<string>();
  const kept: Hit[] = [];
  for (const hit of hits) {
    if (seen.has(hit.key)) continue;
    seen.add(hit.key);
    kept.push(hit);
  }
  return kept.slice(0, MAX_HITS);
}

export function unavailableOf(response: SearchResponse): string[] {
  return Object.entries(response.results).flatMap(([name, value]) =>
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    value.status === "unavailable"
      ? [`${SECTION_NAME[name] ?? name} — ${said((value as { reason?: string }).reason)}`]
      : [],
  );
}
