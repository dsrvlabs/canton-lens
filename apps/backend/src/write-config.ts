// Whether this deployment may submit commands at all. The design this implements is
// docs/ledger-writes.md; the two rules it encodes are that writes are off unless named, and that
// shared-identity never gets them.
//
// Kept separate from readLedgerAuthConfig because the two answer different questions — that one
// answers "whose credential", this one answers "may a credential be used to commit". Folding this
// into the auth config would make the write decision a property of the credential, and it is not:
// a caller-bearer deployment that has not named LEDGER_WRITES is still read-only.

import type { LedgerAuthConfig } from "./auth/config.ts";

export type LedgerWriteConfig = { writes: "enabled" } | { writes: "refused" };

// One accepted spelling. `true`, `1`, `yes` and `on` are refused rather than accepted, so that a
// half-remembered value cannot open a write path a deployer believed was closed — the failure a
// permissive parser produces here commits transactions.
export function readLedgerWriteConfig(
  env: Record<string, string | undefined>,
  auth: LedgerAuthConfig,
): LedgerWriteConfig {
  const value = env.LEDGER_WRITES;
  if (value === undefined || value === "") return { writes: "refused" };
  if (value !== "enabled") {
    throw new Error("Set LEDGER_WRITES=enabled or leave it unset");
  }
  // **The one combination that fails startup rather than degrading.** In shared-identity every
  // caller shares one Canton identity, so a write path would let anyone who can reach the Backend
  // commit transactions as the shared party, and the participant's record would name the service
  // identity rather than whoever asked. Starting with the flag set and the route refused would be a
  // deployment whose configuration says one thing and whose behaviour does another, which the
  // repository's configuration stance — explicit profiles, no inference, no fallback — does not
  // allow. See docs/ledger-writes.md, "Shared Identity refuses writes".
  if (auth.mode === "shared-identity") {
    throw new Error("LEDGER_WRITES=enabled is not available with LEDGER_AUTH_MODE=shared-identity");
  }
  return { writes: "enabled" };
}
