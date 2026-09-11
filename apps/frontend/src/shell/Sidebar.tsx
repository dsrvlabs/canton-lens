// Sidebar — the list beside the content. **It holds destinations only**: the wordmark, search and identity
// belong to the top header. Every destination outside Home lives here. The structure is flat plus one section
// header — there are not even twenty destinations, so a multi-level tree only adds folding and unfolding work.
// **Search is not here** (the header has it), **detail pages are not here** (lists only).
// The look belongs to the design system's Nav — what remains here is the destination list and "where am I now".
import { Nav, NavGroup, NavItem, SidePanel } from "@canton-lens/design-system";
import type { Route } from "../route/hash.ts";

const ITEMS: { view: string; href: string; label: string; sub?: boolean }[] = [
  { view: "home", href: "#/", label: "Home" },
  { view: "transactions", href: "#/transactions", label: "Transactions" },
  { view: "contracts", href: "#/contracts", label: "Contracts" },
  { view: "tokens", href: "#/holdings", label: "Tokens" },
  { view: "holdings", href: "#/holdings", label: "Holdings", sub: true },
  { view: "offers", href: "#/offers", label: "Transfer offers", sub: true },
  { view: "preapprovals", href: "#/preapprovals", label: "Preapprovals", sub: true },
  { view: "parties", href: "#/parties", label: "Parties" },
  { view: "timeline", href: "#/timeline", label: "Timeline" },
  { view: "status", href: "#/status", label: "Status" },
];
const DEVELOPER: typeof ITEMS = [
  { view: "catalog-group", href: "#/packages", label: "Catalog" },
  { view: "packages", href: "#/packages", label: "Packages", sub: true },
  { view: "catalog", href: "#/catalog", label: "Templates", sub: true },
  { view: "api", href: "#/api", label: "API" },
];
// When a sub item lights up, its parent (Tokens · Catalog) lights up with it.
const PARENTS: Record<string, string> = {
  holdings: "tokens",
  offers: "tokens",
  preapprovals: "tokens",
  catalog: "catalog-group",
  packages: "catalog-group",
};

// A detail screen shows under **the list it grew out of** — if opening a party lit up Home instead, it would
// read not as one step in from a list but as having moved somewhere else entirely.
// It is decided by **what the detail is of**, not by which list it was reached from — arriving straight from
// search has to point at the same place.
const ENTITY_HOME: Record<string, string> = {
  tx: "transactions",
  "tx-by-offset": "transactions",
  contract: "contracts",
  party: "parties",
  holding: "holdings",
};

export function Sidebar({ route, open }: { route: Route; open: boolean }) {
  // Mark the current position in the sidebar. An address that cannot be recovered (invalid) belongs to no
  // list, so nothing lights up.
  const current =
    route.view === "entity"
      ? (ENTITY_HOME[route.entity.kind] ?? "")
      : route.view === "instance"
        ? "catalog"
        : route.view;
  const link = (item: (typeof ITEMS)[number]) => (
    <NavItem
      key={item.view}
      href={item.href}
      sub={item.sub ?? false}
      current={item.view === current || item.view === PARENTS[current]}
    >
      {item.label}
    </NavItem>
  );
  return (
    <SidePanel id="sidebar" data-open={open}>
      <Nav>
        {ITEMS.map(link)}
        <NavGroup rule>Developer</NavGroup>
        {DEVELOPER.map(link)}
      </Nav>
    </SidePanel>
  );
}
