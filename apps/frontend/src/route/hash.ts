// **Every screen gets an address.** The frontend ships as static files with no server-side routing, so hashes are used
// rather than paths. A hash does not travel to the server, so any address opens without the host needing a rewrite rule
// per screen. There is no router library — the destination list is short enough for this one file. List filters
// (?template=&party=&before=) live in the query,
// so deep links·back·reload just work and the server is stateless.
import { useEffect, useState } from "react";

export const hashPath = (hash: string = location.hash): string => hash.split("?")[0] ?? "";
export const hashQuery = (hash: string = location.hash): URLSearchParams =>
  new URLSearchParams(hash.split("?")[1] ?? "");

export function parsePartyFilter(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((party) => party.trim())
        .filter(Boolean),
    ),
  );
}

export const normalizePartyFilter = (value: string): string => parsePartyFilter(value).join(",");

// Rewrites the address with part of the query changed (a null value deletes it). It is pushState, so back returns to before the filter.
export function setHashParams(changes: Record<string, string | null | undefined>): void {
  const q = hashQuery();
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === undefined || v === "") q.delete(k);
    else q.set(k, v);
  }
  const path = hashPath() || "#/";
  const query = q.toString();
  const next = query ? `${path}?${query}` : path;
  if (next !== location.hash) location.hash = next;
}

// The address at the current place with part of the query changed — used as a link's href (clicking fires hashchange, and that is the navigation).
export function hashWith(
  changes: Record<string, string | null>,
  hash: string = location.hash,
): string {
  const q = hashQuery(hash);
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === "") q.delete(k);
    else q.set(k, v);
  }
  const path = hashPath(hash) || "#/";
  const query = q.toString();
  return query ? `${path}?${query}` : path;
}
// Destinations. `view` is the name the sidebar·band size looks at — one name per screen, so that
// "which destination am I on" is a single comparison rather than a re-parse of the address.
export type Route =
  | { view: "home" }
  | { view: "search" }
  | { view: "transactions" }
  | { view: "timeline" }
  | { view: "contracts" }
  | { view: "offers" }
  | { view: "holdings" }
  | { view: "preapprovals" }
  | { view: "packages" }
  | { view: "parties" }
  | { view: "instance" }
  | { view: "catalog" }
  | { view: "status" }
  | { view: "api" }
  | { view: "entity"; entity: { kind: "tx"; updateId: string } }
  | { view: "entity"; entity: { kind: "tx-by-offset"; offset: string } }
  | {
      view: "entity";
      entity: { kind: "holding"; owner: string; instrumentId: string; admin: string | null };
    }
  | { view: "entity"; entity: { kind: "contract"; contractId: string } }
  | { view: "entity"; entity: { kind: "party"; partyId: string } }
  // A person can edit the address by hand. If a fragment cannot be recovered, say that fact —
  // the same reason the server router answers 400 invalid_path at the same place.
  | { view: "entity"; entity: { kind: "invalid" } };

export function parseRoute(hash: string): Route {
  const parts = hashPath(hash).replace(/^#\/?/, "").split("/");
  const what = parts[0] ?? "";
  let argument: string | null = null;
  let argument2: string | null = null;
  let argument3: string | null = null;
  try {
    argument = parts[1] ? decodeURIComponent(parts[1]) : null;
    argument2 = parts[2] ? decodeURIComponent(parts[2]) : null;
    argument3 = parts[3] ? decodeURIComponent(parts[3]) : null;
  } catch {
    return { view: "entity", entity: { kind: "invalid" } };
  }
  if (what === "search") return { view: "search" };
  if (what === "transactions") return { view: "transactions" };
  if (what === "timeline") return { view: "timeline" };
  if (what === "contracts") return { view: "contracts" };
  if (what === "offers") return { view: "offers" };
  if (what === "holdings") return { view: "holdings" };
  if (what === "preapprovals") return { view: "preapprovals" };
  if (what === "packages") return { view: "packages" };
  // #/account is the old name — opens the same place so saved bookmarks do not die.
  if (what === "parties" || what === "account") return { view: "parties" };
  if (what === "instance") return { view: "instance" };
  if (what === "catalog") return { view: "catalog" };
  if (what === "status" || what === "node") return { view: "status" };
  if (what === "api") return { view: "api" };
  if (what === "tx" && argument === "by-offset" && argument2)
    return { view: "entity", entity: { kind: "tx-by-offset", offset: argument2 } };
  if (what === "tx" && argument)
    return { view: "entity", entity: { kind: "tx", updateId: argument } };
  if (what === "holding" && argument && argument2)
    return {
      view: "entity",
      entity: { kind: "holding", owner: argument, instrumentId: argument2, admin: argument3 },
    };
  if (what === "contract" && argument)
    return { view: "entity", entity: { kind: "contract", contractId: argument } };
  if (what === "party" && argument)
    return { view: "entity", entity: { kind: "party", partyId: argument } };
  return { view: "home" };
}

// The current hash. Reacts to hash navigation.
export function useHash(): string {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

// Link addresses — encoding in one place.
export const href = {
  search: (q: string) => `#/search?${new URLSearchParams({ q })}`,
  tx: (updateId: string) => `#/tx/${encodeURIComponent(updateId)}`,
  txByOffset: (offset: number | string) => `#/tx/by-offset/${encodeURIComponent(String(offset))}`,
  contract: (contractId: string) => `#/contract/${encodeURIComponent(contractId)}`,
  party: (party: string) => `#/party/${encodeURIComponent(party)}`,
  contractsOfTemplate: (module: string, entity: string) =>
    `#/contracts?template=${encodeURIComponent(`${module}:${entity}`)}`,
  // The address is the group key as is: owner · instrument id · **admin** (a standard instrument is an admin+id pair — the same id with a different
  // issuer is a different balance, and without admin two balances would share one address). The adapter path without admin has two pieces.
  holding: (g: { owner: string; instrumentId: string; instrumentAdmin: string | null }) =>
    `#/holding/${encodeURIComponent(g.owner)}/${encodeURIComponent(g.instrumentId)}` +
    (g.instrumentAdmin ? `/${encodeURIComponent(g.instrumentAdmin)}` : ""),
};
