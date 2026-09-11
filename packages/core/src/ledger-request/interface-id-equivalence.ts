// The single chokepoint that decides whether two interface id notations (name notation "#pkgName:Module:Entity" vs hash notation
// "packagehash:Module:Entity") point to the same interface.
// This decision is not re-implemented in any other file.

// The two notations for the package segment. The name form starts with `#`, the hash form is 64 sha256
// hex characters. **A dot never appears in a name** — the ledger says so ("non expected character 0x2e in
// Daml-LF Package Name"). Counting the 34 package names on this node, none had a dot or an underscore;
// all were letters, digits and hyphens (daml-prim-DA-Internal-Erased, splice-api-token-holding-v1 …).
const PACKAGE_PART = /^(?:#[A-Za-z0-9_-]+|[0-9a-f]{64})$/;
// Only the **first character** of a Daml-LF name is checked — it starts with a letter or an underscore.
// A module is several such names joined by dots.
// **This does not implement Daml's full name grammar.** That is the ledger's judgment; all this wants to do
// is “not send something that is not an id to the ledger” — things like `0:0:0` used to go straight out, the
// ledger rejected them with INVALID_FIELD, and that was reported as a 502 (a server fault).
const LF_NAME = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/**
 * Whether an interface or template id is **at least well-formed**. It does not judge existence —
 * even after passing this, the ledger may answer “no such package”.
 */
export function isWellFormedInterfaceId(input: string): boolean {
  const parts = input.split(":");
  if (parts.length !== 3) return false;
  const [pkg, moduleName, entity] = [parts[0] ?? "", parts[1] ?? "", parts[2] ?? ""];
  if (!PACKAGE_PART.test(pkg)) return false;
  if (moduleName === "" || !moduleName.split(".").every((seg) => LF_NAME.test(seg))) return false;
  return LF_NAME.test(entity);
}

export function interfaceIdsMatch(a: string, b: string): boolean {
  const partsA = a.split(":");
  const partsB = b.split(":");
  if (partsA.length !== 3 || partsB.length !== 3) {
    return false;
  }

  // Both sides were checked above to have length 3, so all six pieces must exist.
  // noUncheckedIndexedAccess cannot see that check, so narrow with ?? "".
  const pkgA = partsA[0] ?? "";
  const moduleA = partsA[1] ?? "";
  const entityA = partsA[2] ?? "";
  const pkgB = partsB[0] ?? "";
  const moduleB = partsB[1] ?? "";
  const entityB = partsB[2] ?? "";

  if (moduleA !== moduleB || entityA !== entityB) {
    return false;
  }

  const aIsName = pkgA.startsWith("#");
  const bIsName = pkgB.startsWith("#");

  if (aIsName || bIsName) {
    // At least one side is in name notation — treat them as equal on module/entity match alone.
    return true;
  }

  // Both sides are in hash notation — the hash strings must match exactly as well.
  return pkgA === pkgB;
}
