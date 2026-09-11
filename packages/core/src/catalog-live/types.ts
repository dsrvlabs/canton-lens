// Decision result types for screen 6 (Template catalog · Package catalog).
// When a value is structurally absent from this layer's response, it is carried not as an empty string or null
// but as UnavailableInThisLayer, saying that the field is absent rather than empty.

export type UnavailableInThisLayer = {
  status: "unavailable_in_this_layer";
};

export type InMyContractsFlag =
  | { status: "in_set" }
  | { status: "not_in_set" }
  | { status: "unknown"; reason: "my_package_ids_not_provided" };

export type LiveTemplateCatalogRow = {
  templateId: string;
  packageId: string;
  packageName: string;
  module: string;
  entity: string;
  contractCount: number;
};

export type BuildTemplateCatalogResult =
  | { ok: true; scope: "visible_to_requester"; rows: LiveTemplateCatalogRow[] }
  | { ok: false; reason: string };

// When passing myPackageIds, the elements of that set must be packageId (hash) strings.
// Putting in full templateIds always yields not_in_set, producing a silently wrong result.
export type LivePackageCatalogRow = {
  packageId: string;
  name: string | UnavailableInThisLayer;
  version: string | UnavailableInThisLayer;
  inMyContracts: InMyContractsFlag;
};

export type BuildPackageCatalogResult =
  | { ok: true; scope: "instance_wide"; rows: LivePackageCatalogRow[] }
  | { ok: false; reason: string };
