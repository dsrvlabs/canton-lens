import { BrowserOidcAuth } from "./browser-oidc.ts";
import type { AuthConfig } from "./config.ts";

let browserOidc: BrowserOidcAuth | null = null;
let mode: AuthConfig["mode"] | null = null;

export function configureAuth(config: AuthConfig): BrowserOidcAuth | null {
  mode = config.mode;
  browserOidc?.invalidate();
  browserOidc = null;
  if (config.mode === "browser-oidc") {
    browserOidc = new BrowserOidcAuth(config, {
      // Access storage lazily so blocked sessionStorage becomes a recoverable login failure.
      storage: {
        getItem: (key) => window.sessionStorage.getItem(key),
        setItem: (key, value) => window.sessionStorage.setItem(key, value),
        removeItem: (key) => window.sessionStorage.removeItem(key),
      },
      href: () => window.location.href,
      replaceUrl: (url) => window.history.replaceState(null, "", url),
      navigate: (url) => window.location.assign(url),
      fetch: (...args) => window.fetch(...args),
      now: () => Date.now(),
    });
    // A restored back/forward-cache document must not resurrect credentials or ledger UI.
    window.addEventListener("pagehide", () => browserOidc?.invalidate());
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) browserOidc?.invalidate();
    });
  }
  return browserOidc;
}

export const getBrowserOidcAuth = (): BrowserOidcAuth | null => browserOidc;
export const isSharedIdentity = (): boolean => mode === "shared-identity";
