// The shell: the top header (wordmark · search · identity) above the sidebar (destinations) and the content.
// The address (the hash) decides which screen is drawn, and SessionProvider holds the data.

import {
  Shell as AppShell,
  Banner,
  Crumb,
  FloatingButton,
  RefreshIcon,
} from "@canton-lens/design-system";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ContractDetail } from "./entity/ContractDetail.tsx";
import { HoldingDetail } from "./entity/HoldingDetail.tsx";
import { PartyDetail } from "./entity/PartyDetail.tsx";
import { TxDetail } from "./entity/TxDetail.tsx";
import { Api } from "./pages/Api.tsx";
import { Contracts } from "./pages/Contracts.tsx";
import { Developer } from "./pages/Developer.tsx";
import { Holdings } from "./pages/Holdings.tsx";
import { Home } from "./pages/Home.tsx";
import { Offers } from "./pages/Offers.tsx";
import { Parties } from "./pages/Parties.tsx";
import { Preapprovals } from "./pages/Preapprovals.tsx";
import { Search } from "./pages/Search.tsx";
import { Status } from "./pages/Status.tsx";
import { Timeline } from "./pages/Timeline.tsx";
import { Transactions } from "./pages/Transactions.tsx";
import { hashPath, parseRoute, type Route, useHash } from "./route/hash.ts";
import { SessionProvider, useSession } from "./session/SessionContext.tsx";
import { Header } from "./shell/Header.tsx";
import { Sidebar } from "./shell/Sidebar.tsx";
import { SignInRequired } from "./shell/SignInRequired.tsx";

export function App() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}

const TITLES: Record<string, string> = {
  search: "Search",
  transactions: "Transactions",
  timeline: "Timeline",
  contracts: "Contracts",
  offers: "Transfer offers",
  holdings: "Holdings",
  preapprovals: "Preapprovals",
  parties: "Parties",
  instance: "Developer",
  catalog: "Templates",
  packages: "Packages",
  status: "Status",
  api: "API",
  entity: "Details",
};

function Shell() {
  const hash = useHash();
  const route = parseRoute(hash);
  const { error, home, loading, refresh, signInRequired } = useSession();
  // A changed screen (path) starts at the top — clicking a tab from far down Home left a short screen
  // snagged at the old scroll position and jumping.
  // A change of query only (filters, Older/Newer) is the same screen, so it is left alone.
  // The first paint (a reload) is not touched — the position the browser restored is the right one.
  const path = hashPath(hash);
  // The narrow-screen destination menu (the hamburger). Being open is the shell's state, not a screen's, so
  // it lives here — SessionContext is the place that holds what was read from the ledger.
  const [menuOpen, setMenuOpen] = useState(false);
  const scrolledFor = useRef(path);
  useLayoutEffect(() => {
    if (scrolledFor.current === path) return;
    scrolledFor.current = path;
    window.scrollTo(0, 0);
    // Once a destination is chosen, close the menu too — left open across a screen change it hides what is
    // being looked at.
    // It sits in the same effect as the scroll reset because the condition is the same: "the path changed".
    setMenuOpen(false);
  }, [path]);
  // Escape closes it too.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  // The tab title says the screen — for someone moving between several open tabs, three of "Canton Lens"
  // tell nothing apart.
  useEffect(() => {
    const t = TITLES[route.view];
    document.title = t ? `${t} — Canton Lens` : "Canton Lens";
  }, [route.view]);
  // Institution BFF mode uses the server's recovery link; browser-oidc 401s unmount this shell at AuthBoundary.
  // Placed after the hooks: an early return must not change hook order.
  if (signInRequired !== null) {
    return <SignInRequired entryUrl={signInRequired.entryUrl} />;
  }
  return (
    <>
      <a className="clds-skip" href="#main">
        Skip to content
      </a>
      <Header hash={hash} menuOpen={menuOpen} onMenuToggle={() => setMenuOpen((open) => !open)} />
      {/* The scrim behind the open menu on narrow screens — clicking closes. Not drawn on desktop (CSS). */}
      {menuOpen ? (
        <button
          type="button"
          className="scrim"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}
      <AppShell side={<Sidebar route={route} open={menuOpen} />}>
        <div id="error">{error !== null ? <Banner>{error}</Banner> : null}</div>
        {/* No screen is drawn before Home has been read once — drawing with the session still empty makes
            "none" and "not read yet" look the same. Home itself is drawn as soon as it arrives. */}
        {home === null ? null : <Page route={route} hash={hash} />}
      </AppShell>
      {/* Refresh — the round button floating at the bottom right. It re-reads Home's values at the same
          offset and **redraws exactly the place being looked at** (it does not touch the address,
          SessionContext.refresh). While it reads it cannot be pressed, and its icon spins. */}
      <FloatingButton
        label={loading ? "Refreshing…" : "Refresh — re-read the ledger"}
        busy={loading}
        onClick={() => void refresh()}
      >
        <RefreshIcon />
      </FloatingButton>
    </>
  );
}

function Page({ route, hash }: { route: Route; hash: string }) {
  switch (route.view) {
    case "home":
      return <Home />;
    case "search":
      return <Search hash={hash} />;
    case "transactions":
      return <Transactions hash={hash} />;
    case "contracts":
      return <Contracts hash={hash} />;
    case "offers":
      return <Offers />;
    case "holdings":
      return <Holdings />;
    case "preapprovals":
      return <Preapprovals />;
    case "timeline":
      return <Timeline hash={hash} />;
    case "parties":
      return <Parties />;
    case "api":
      return <Api />;
    case "status":
      return <Status />;
    case "instance":
    case "catalog":
    case "packages":
      return <Developer show={route.view} />;
    case "entity":
      return <Entity route={route} hash={hash} />;
    default:
      return null;
  }
}

// **Entity pages.** Transactions, contracts and parties each have a place of their own, and you move
// between them by clicking. They are separate screens rather than one panel inside Home so that they can
// have an address (`#/tx/…` · `#/contract/…` · `#/party/…`).
// A detail component is keyed by identity (its id) — so that moving straight from A to B never flashes A's
// state under B's heading.
function Entity({ route, hash }: { route: Extract<Route, { view: "entity" }>; hash: string }) {
  const { generation } = useSession();
  const e = route.entity;
  return (
    <div id="entity">
      <Crumb>
        <a href="#/">Back</a>
      </Crumb>
      {e.kind === "invalid" ? <InvalidAddress key={`${hash}|${generation}`} /> : null}
      {e.kind === "tx" ? (
        <TxDetail key={`id:${e.updateId}`} target={{ updateId: e.updateId }} />
      ) : null}
      {e.kind === "tx-by-offset" ? (
        <TxDetail key={`offset:${e.offset}`} target={{ offset: e.offset }} />
      ) : null}
      {e.kind === "holding" ? (
        <HoldingDetail
          key={`${e.owner}|${e.instrumentId}|${e.admin ?? ""}`}
          owner={e.owner}
          instrumentId={e.instrumentId}
          admin={e.admin}
        />
      ) : null}
      {e.kind === "contract" ? (
        <ContractDetail key={e.contractId} contractId={e.contractId} />
      ) : null}
      {e.kind === "party" ? <PartyDetail key={e.partyId} partyId={e.partyId} hash={hash} /> : null}
    </div>
  );
}

// An address fragment that cannot be recovered — said through the banner. From an effect, not from render
// (it changes state).
// A full re-read clears the banner (load empties the error), so this remounts once per generation and says
// it again (the generation is in the key).
// Without that, one refresh would silently drop the fact that the address was wrong.
function InvalidAddress() {
  const { fail } = useSession();
  useEffect(() => {
    fail("Could not read the address — the path contains an invalid character");
  }, [fail]);
  return null;
}
