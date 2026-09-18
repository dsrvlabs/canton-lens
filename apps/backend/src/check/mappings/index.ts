// **Which addresses have their answer written out again by hand, and which do not yet.**
//
// Sixteen of the seventeen operations have no mapping today. That is deliberate and it must stay visible: a
// missing entry means "this address is judged by the first three levels only", not "this address is fine".
// Applying a comparator to an address with no rules would compare against nothing and call it green.
import type { CheckContext, Mapping } from "../mapping.ts";
import { contractsMapping } from "./contracts.ts";

/** Keyed by the check table's name for the address (`spec.name ?? spec.template`). */
export const MAPPINGS: Record<string, Mapping<CheckContext>> = {
  // The same rules answer both: the page size is read from the address, so the second one exercises the cut
  // list and the cursor that the default page size never reaches.
  "/api/contracts": contractsMapping,
  "/api/contracts?pageSize=2": contractsMapping,
};
