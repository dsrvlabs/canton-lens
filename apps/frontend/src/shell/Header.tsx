// Header — one row across the window: wordmark · search · identity.
//
// The three belong together: the product's name, the one way in, and whose eyes these are.
// The sidebar carries destinations only.
//
// It sticks to the top, so search and identity stay in reach while a long list scrolls.
// The read progress bar rides along its bottom edge.
import { Badge, LoadingBar, Mono } from "@canton-lens/design-system";
import { useEffect, useRef } from "react";
import { getBrowserOidcAuth, isSharedIdentity } from "../auth/runtime.ts";
import { SearchPreview } from "../search/SearchPreview.tsx";
import { useSession } from "../session/SessionContext.tsx";

import { ThemeToggle } from "./ThemeToggle.tsx";

export function Header({
  hash,
  menuOpen,
  onMenuToggle,
}: {
  hash: string;
  menuOpen: boolean;
  onMenuToggle: () => void;
}) {
  const { session, home, loading, logoutUrl } = useSession();

  // Identity and parties come from Canton's authenticated-user/rights responses, not an invented name
  // or Browser token decoding. They describe the individual caller or the configured shared service.
  // The whole-instance badge reflects the ledger rights reported through the API.
  const view = session && session.outcome === "view" ? session : null;
  const id = view?.userId ?? "";
  const total = view?.parties.length ?? 0;

  // Write onto the document, as --menu-top, the line where the open destination menu (the covering panel)
  // starts: **right below the first row (bars · wordmark)** of the narrow-screen header — the identity chip
  // and the search row beneath it are what the menu covers. CSS alone cannot know the first row's height, so
  // measure it as the bar button's bottom edge + the gap between rows (10px). The header is sticky top:0, so
  // offsetTop is already relative to the window.
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const write = () => {
      const bar = el.querySelector<HTMLElement>(".menu-toggle");
      const rowBottom =
        bar && bar.offsetHeight > 0 ? bar.offsetTop + bar.offsetHeight + 10 : el.offsetHeight;
      document.documentElement.style.setProperty("--menu-top", `${rowBottom}px`);
    };
    write();
    const ro = new ResizeObserver(write);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <header className="header" ref={headerRef}>
      {/* The narrow-screen destination menu — hidden on desktop, where the sidebar is always visible (CSS).
        The three bars are a picture. This product's notation principle is "say it in words", and a picture
        earns its place here on the same grounds as the search button: on a narrow screen this picture reads
        faster than any word. The aria-label says the word alongside it. */}
      <button
        type="button"
        className="menu-toggle"
        aria-label={menuOpen ? "Close menu" : "Open menu"}
        aria-expanded={menuOpen}
        aria-controls="sidebar"
        onClick={onMenuToggle}
      >
        <span className="menu-toggle__bars" aria-hidden="true" />
      </button>
      {/* Wordmark — clicking goes home */}
      <h1 className="brand">
        <a href="#/">
          <span className="brand-name">Canton Lens</span>
        </a>
      </h1>
      {/* The search row belongs to its own component — the input, the preview panel and the `/` shortcut
        have to live in one place to stay in step. The magnifier button is one of this product's two picture
        exceptions: here a picture reads faster than a word. */}
      <SearchPreview hash={hash} />
      {/* Whose eyes these are. Clicking goes to Status — the screen that writes down on one panel where the
        identity and connection this chip states came from (the party list links on again from there). */}
      {/* Identity and sign-out are siblings, never nested interactive elements. Keep sign-out available
        even if the ledger session failed to load. Shared identity never offers user sign-out. */}
      {view || getBrowserOidcAuth() || (!isSharedIdentity() && logoutUrl) ? (
        <span className="viewer" id="viewer">
          {view ? (
            <a className="viewer__who" href="#/status">
              <Mono
                id="who"
                title={`${isSharedIdentity() ? "Shared Canton service identity" : "Signed-in ledger user id — the token's sub"}\n${id}`}
              >
                {id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id}
              </Mono>
              <span className="parties" id="who-parties">
                {total} {total === 1 ? "party" : "parties"}
              </span>
              {home?.viewer?.scope && home.viewer.scope !== "own" ? (
                <Badge id="who-scope">whole instance</Badge>
              ) : null}
            </a>
          ) : null}
          {/* Browser OIDC owns its logout; institution BFF uses only the front-provided URL. */}
          {getBrowserOidcAuth() ? (
            <button
              type="button"
              className="logout"
              onClick={() => void getBrowserOidcAuth()?.logout()}
            >
              Sign out
            </button>
          ) : !isSharedIdentity() && logoutUrl ? (
            <a className="logout" href={logoutUrl} title="Sign out of Canton Lens only">
              Sign out
            </a>
          ) : null}
        </span>
      ) : null}
      <ThemeToggle />
      <LoadingBar active={loading} label="Reading the ledger" />
    </header>
  );
}
