// **Which addresses have their answer written out again by hand, and which do not yet.**
//
// An address with no entry here is judged by the first three levels only. That is deliberate and it must
// stay visible: a missing entry means "nobody has written down what this answer should hold", not "this
// address is fine".
// Applying a comparator to an address with no rules would compare against nothing and call it green.
import type { CheckContext, Mapping } from "../mapping.ts";
import { nameTables } from "../mapping.ts";
import { contractDetailMapping } from "./contract-detail.ts";
import { contractsMapping } from "./contracts.ts";
import { holdingsMapping } from "./holdings.ts";
import { homeMapping } from "./home.ts";
import { nodeMapping } from "./node.ts";
import { offersMapping } from "./offers.ts";
import { packageSchemaMapping } from "./package-schema.ts";
import { packagesCatalogMapping } from "./packages-catalog.ts";
import { partyMapping } from "./party.ts";
import { preapprovalsMapping } from "./preapprovals.ts";
import { searchMapping } from "./search.ts";
import { sessionMapping } from "./session.ts";
import { templatesCatalogMapping } from "./templates-catalog.ts";
import { timelineMapping } from "./timeline.ts";
import { updateDetailMapping } from "./update-detail.ts";
import { updatesMapping } from "./updates.ts";

/** Keyed by the check table's name for the address (`spec.name ?? spec.template`). */
export const MAPPINGS: Record<string, Mapping<CheckContext>> = {
  // The same rules answer both: the page size is read from the address, so the second one exercises the cut
  // list and the cursor that the default page size never reaches.
  "/api/contracts": contractsMapping,
  "/api/contracts?pageSize=2": contractsMapping,
  // The same rules, asked once more with the cursor the small page handed back. One address, two questions —
  // and the second is the only one where a cursor that does not advance shows up at all.
  "/api/contracts (the second page)": contractsMapping,
  // The same rules again, asked for the whole list — the page size is read off the address, so nothing in
  // them changes. What this address exists for is the answer key (check/own-set.ts).
  "/api/contracts (every one)": contractsMapping,
  "/api/contracts/{contractId}": contractDetailMapping,
  "/api/catalog/packages": packagesCatalogMapping,
  "/api/catalog/templates": templatesCatalogMapping,
  "/api/offers": offersMapping,
  "/api/packages/{packageId}/schema": packageSchemaMapping,
  "/api/holdings": holdingsMapping,
  "/api/home": homeMapping,
  "/api/node": nodeMapping,
  "/api/party/{partyId}": partyMapping,
  "/api/preapprovals": preapprovalsMapping,
  "/api/search": searchMapping,
  "/api/session": sessionMapping,
  "/api/updates": updatesMapping,
  "/api/updates (every one)": updatesMapping,
  // The same rules answer both addresses: they differ only in how the update was named, and what an update
  // *is* cannot depend on that.
  "/api/updates/{updateId}": updateDetailMapping,
  "/api/updates/by-offset/{offset}": updateDetailMapping,
  "/api/timeline": timelineMapping,
};

// **Every table learns the name of the schema it describes**, so a rule that runs can be written down under
// it. Done here rather than in each mapping because this is the one place that knows them all, and a mapping
// that forgot would go uncounted in silence — which reads as "that slot is never judged" (check/coverage.ts).
for (const mapping of new Set(Object.values(MAPPINGS))) nameTables(mapping);
