import assert from "node:assert/strict";
import { test } from "node:test";
import configureVite from "../vite.config.ts";

test("every explicit profile forwards only API/OpenAPI, never institution auth routes", (t) => {
  const originalMode = process.env.VITE_AUTH_MODE;
  const originalTarget = process.env.BACKEND_PROXY_TARGET;
  t.after(() => {
    if (originalMode === undefined) delete process.env.VITE_AUTH_MODE;
    else process.env.VITE_AUTH_MODE = originalMode;
    if (originalTarget === undefined) delete process.env.BACKEND_PROXY_TARGET;
    else process.env.BACKEND_PROXY_TARGET = originalTarget;
  });
  for (const mode of ["browser-oidc", "shared-identity", "institution-bff"]) {
    process.env.VITE_AUTH_MODE = mode;
    const target = mode === "institution-bff" ? "https://institution.example" : "http://localhost:7600";
    process.env.BACKEND_PROXY_TARGET = target;
    const config = configureVite({ command: "serve", mode: "test" });
    for (const transport of [config.server, config.preview]) {
      assert.deepEqual(Object.keys(transport.proxy).sort(), ["/api", "/openapi.json"]);
      for (const route of Object.values(transport.proxy)) assert.equal(route.target, target);
    }
  }
  process.env.VITE_AUTH_MODE = "invalid";
  assert.throws(() => configureVite({ command: "serve", mode: "test" }), /Select VITE_AUTH_MODE/);
});
