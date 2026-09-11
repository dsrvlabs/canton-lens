import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("merged identity chip preserves Status routing and profile-specific sign-out", async (t) => {
  // Render the actual Header with deterministic session/auth inputs and no browser/network effects.
  globalThis.__headerFixture = {};
  globalThis.document = { documentElement: { dataset: { theme: "light" } } };
  t.after(() => { delete globalThis.__headerFixture; delete globalThis.document; });
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("..", import.meta.url)),
    // CI runs tests before any build; use workspace sources, never a pre-existing dist artifact.
    resolve: { alias: { "@canton-lens/design-system": fileURLToPath(new URL("../../../packages/design-system/src/index.ts", import.meta.url)) } },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [{
      name: "header-fixtures",
      enforce: "pre",
      resolveId(source, importer) {
        if (!importer?.endsWith("/shell/Header.tsx") && !importer?.endsWith("/search/SearchPreview.tsx")) return;
        if (source.endsWith("/api/client.ts")) return "\0header-client";
        if (source.endsWith("/SessionContext.tsx")) return "\0header-session";
        if (source.endsWith("/auth/runtime.ts")) return "\0header-auth";
      },
      load(id) {
        if (id === "\0header-client") return "export const messageOf = error => String(error);";
        if (id === "\0header-session") return "export const useSession = () => globalThis.__headerFixture.session;";
        if (id === "\0header-auth") return `
          export const getBrowserOidcAuth = () => globalThis.__headerFixture.browserOidc;
          export const isSharedIdentity = () => globalThis.__headerFixture.service;
        `;
      },
    }],
  });
  t.after(() => server.close());
  const { Header } = await server.ssrLoadModule("/src/shell/Header.tsx");
  for (const mode of ["browser-oidc", "institution-bff", "shared-identity"]) {
    for (const hasIdentity of [true, false]) {
      await t.test(`${mode}, ledger identity ${hasIdentity ? "loaded" : "unavailable"}`, () => {
        globalThis.__headerFixture = {
          service: mode === "shared-identity",
          browserOidc: mode === "browser-oidc" ? { logout() {} } : null,
          session: {
            session: hasIdentity ? { outcome: "view", userId: "fixture-user", parties: [] } : null,
            home: null, loading: false, generation: 0, clearError() {},
            // Shared identity must ignore even an injected institution logout hint.
            logoutUrl: "/institution/logout",
          },
        };
        const html = renderToStaticMarkup(createElement(Header, {
          route: { view: "home" }, hash: "#/", menuOpen: false, onMenuToggle() {},
        }));
        assert.equal(html.includes('class="viewer__who" href="#/status"'), hasIdentity);
        assert.equal(html.includes("Sign out"), mode !== "shared-identity");
        if (mode === "browser-oidc") assert.match(html, /<button[^>]*class="logout"/);
        if (mode === "institution-bff") assert.match(html, /<a class="logout" href="\/institution\/logout"/);
        if (mode === "shared-identity" && hasIdentity) assert.match(html, /Shared Canton service identity/);
        let interactive = false;
        for (const tag of html.matchAll(/<(\/?)(a|button)\b[^>]*>/g)) {
          if (tag[1]) interactive = false;
          else {
            assert.equal(interactive, false, "links and buttons must never be nested");
            interactive = true;
          }
        }
      });
    }
  }
});
