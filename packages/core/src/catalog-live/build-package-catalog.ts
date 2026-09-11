// The Package catalog (screen 6) transcribes the /v2/packages response (which has only a packageIds array).
// This response lists every package installed on the participant regardless of party,
// so there is no visibility judgment and scope is always instance_wide.
// name/version are structurally absent from this layer's response, so instead of a value they are filled
// with a structural value meaning "this response does not carry it".

import type {
  BuildPackageCatalogResult,
  LivePackageCatalogRow,
  UnavailableInThisLayer,
} from "./types.ts";

const NAME_VERSION_UNAVAILABLE: UnavailableInThisLayer = {
  status: "unavailable_in_this_layer",
};

// namesByPackageId: the packageName of the packages my contracts use (from ACS createdEvent) — layer 1's ListPackages gives only ids, so
// names are filled **only where known** and the rest are left as “not in this layer” rather than guessed. Once the decoder arrives, all of them get filled.
export function buildPackageCatalog(
  packagesResponse: unknown,
  myPackageIds?: Set<string> | string[],
  namesByPackageId?: ReadonlyMap<string, string>,
): BuildPackageCatalogResult {
  if (packagesResponse === null || typeof packagesResponse !== "object") {
    return { ok: false, reason: "missing_field:packageIds" };
  }
  const packageIds = (packagesResponse as Record<string, unknown>).packageIds;
  if (!Array.isArray(packageIds)) {
    return { ok: false, reason: "missing_field:packageIds" };
  }
  for (const [i, id] of packageIds.entries()) {
    if (typeof id !== "string") {
      return { ok: false, reason: `invalid_shape:packageIds[${i}]_not_a_string` };
    }
  }

  const knownSet: Set<string> | undefined =
    myPackageIds === undefined
      ? undefined
      : myPackageIds instanceof Set
        ? myPackageIds
        : new Set(myPackageIds);

  const rows: LivePackageCatalogRow[] = (packageIds as string[])
    .slice()
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((packageId) => ({
      packageId,
      name: namesByPackageId?.get(packageId) ?? NAME_VERSION_UNAVAILABLE,
      version: NAME_VERSION_UNAVAILABLE,
      inMyContracts:
        knownSet === undefined
          ? { status: "unknown" as const, reason: "my_package_ids_not_provided" as const }
          : knownSet.has(packageId)
            ? { status: "in_set" as const }
            : { status: "not_in_set" as const },
    }));

  return { ok: true, scope: "instance_wide", rows };
}
