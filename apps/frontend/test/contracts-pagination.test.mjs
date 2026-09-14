import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createServer } from "vite";

const row = (contractId) => ({
  contractId, entity: "Holding", module: "Explorer", package: "a".repeat(64),
  packageName: "example", createdAt: "2026-09-06T00:00:00Z", myRoles: [],
});
const cursor = { offset: 100, createdAt: "2026-09-06T00:00:00Z", contractId: "cursor" };
const page = (id, filter = {}, nextCursor = null) => ({
  rows: [row(id)], filter, nextCursor, total: 39, matched: 2, offset: 172,
});

test("contract pagination respects the lifetime of its initial read", async (t) => {
  const dom = new JSDOM("<!DOCTYPE html><body></body>", { url: "http://localhost/#/contracts" });
  const globals = {
    window: dom.window, document: dom.window.document, location: dom.window.location,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
    IS_REACT_ACT_ENVIRONMENT: true, __contractsFixture: null,
  };
  const originals = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, globals);
  t.after(() => {
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("..", import.meta.url)),
    resolve: { alias: { "@canton-lens/design-system": fileURLToPath(new URL("../../../packages/design-system/src/index.ts", import.meta.url)) } },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [{
      name: "controlled-contract-requests", enforce: "pre",
      resolveId(source) {
        if (source.endsWith("/SessionContext.tsx")) return "\0contracts-session";
        if (source.endsWith("/api/client.ts")) return "\0contracts-client";
      },
      load(id) {
        if (id === "\0contracts-session") return "export const useSession = () => globalThis.__contractsFixture;";
        if (id === "\0contracts-client") return "export const messageOf = error => error.message;";
      },
    }],
  });
  t.after(() => server.close());
  const { Contracts } = await server.ssrLoadModule("/src/pages/Contracts.tsx");

  async function setup(t) {
    const pending = [];
    const failures = [];
    const session = {
      api: (path) => new Promise((resolve, reject) => pending.push({ path, resolve, reject })),
      lastOffset: 172, loading: false, generation: 1, templates: { rows: [] }, myParties: [],
      fail: (error) => failures.push(error),
    };
    globalThis.__contractsFixture = session;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let mounted = true;
    const unmount = async () => {
      if (mounted) await act(async () => root.unmount());
      mounted = false;
    };
    t.after(async () => { await unmount(); container.remove(); });
    const render = async (hash = "#/contracts") => {
      await act(async () => {
        location.hash = hash;
        root.render(createElement(Contracts, { hash }));
      });
    };
    const settle = async (request, response) => act(async () => request.resolve(response));
    const ids = () => [...container.querySelectorAll('#list a[href^="#/contract/"]')].map((link) => link.textContent);
    await render();
    await settle(pending.shift(), page("first-page", {}, cursor));
    await act(async () => container.querySelector("#more").click());
    const older = pending.shift();
    assert.ok(older.path.includes("cursorContractId=cursor"));
    return { pending, failures, session, container, render, settle, ids, older, unmount };
  }

  await t.test("appends the next page when the read is still current", async (t) => {
    const c = await setup(t);
    await c.settle(c.older, page("second-page"));
    assert.deepEqual(c.ids(), ["first-page", "second-page"]);
    assert.equal(c.container.querySelector("#more"), null);
  });

  for (const [name, hash, filter, update] of [
    ["template change", "#/contracts?template=TransferOffer", { template: "TransferOffer" }, () => {}],
    ["party change", "#/contracts?party=Alice", { parties: ["Alice"] }, () => {}],
    ["refresh", "#/contracts", {}, (s) => { s.generation++; }],
    ["offset change", "#/contracts", {}, (s) => { s.lastOffset++; }],
  ]) {
    await t.test(`ignores an Older response after ${name}`, async (t) => {
      const c = await setup(t);
      update(c.session);
      await c.render(hash);
      await c.settle(c.pending.shift(), page("new-result", filter));
      assert.deepEqual(c.ids(), ["new-result"]);
      await c.settle(c.older, page("stale-page"));
      assert.deepEqual(c.ids(), ["new-result"]);
    });
  }

  await t.test("ignores Older while the session refresh is still loading", async (t) => {
    const c = await setup(t);
    c.session.loading = true;
    await c.render();
    await c.settle(c.older, page("stale-page"));
    assert.deepEqual(c.ids(), ["first-page"]);
    await act(async () => c.container.querySelector("#more").click());
    assert.equal(c.pending.length, 0, "cannot page a cancelled read");
  });

  await t.test("returning to the same filter does not revive an abandoned Older request", async (t) => {
    const c = await setup(t);
    await c.render("#/contracts?template=TransferOffer");
    await c.settle(c.pending.shift(), page("filtered", { template: "TransferOffer" }));
    await c.render();
    await c.settle(c.pending.shift(), page("new-unfiltered"));
    await c.settle(c.older, page("stale-page"));
    assert.deepEqual(c.ids(), ["new-unfiltered"]);
  });

  for (const abandon of [false, "filter", "unmount"]) {
    await t.test(`pagination failure: ${abandon || "current read"}`, async (t) => {
      const c = await setup(t);
      if (abandon === "filter") {
        await c.render("#/contracts?template=TransferOffer");
        await c.settle(c.pending.shift(), page("new-result", { template: "TransferOffer" }));
      } else if (abandon === "unmount") await c.unmount();
      await act(async () => c.older.reject(new Error("older failed")));
      assert.deepEqual(c.failures, abandon ? [] : ["older failed"]);
    });
  }
});
