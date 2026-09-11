import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig, loadEnv } from "vite";

// This screen does not know which path it was delivered under — it could be the root, or under the console's
// `/explorer/`. `base: "./"` makes asset addresses document-relative so both cases open as is
// (the same reason API calls are relative paths, src/api/client.ts).
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const authMode = env.VITE_AUTH_MODE;
  if (
    authMode !== "browser-oidc" &&
    authMode !== "institution-bff" &&
    authMode !== "shared-identity"
  ) {
    throw new Error(
      "Select VITE_AUTH_MODE=browser-oidc, institution-bff or shared-identity in apps/frontend/.env",
    );
  }
  const backend = env.BACKEND_PROXY_TARGET;
  if (command === "serve" && !backend) {
    throw new Error(
      "BACKEND_PROXY_TARGET is missing — copy apps/frontend/.env.example to apps/frontend/.env",
    );
  }

  // In development and preview the frontend owns the browser origin and forwards only backend-owned
  // routes in every mode. Institution login/callback/logout routes belong to the institution's own gateway,
  // not to this transport configuration. Production hosts apply the route map in docs/deployment.md.
  const proxy = backend
    ? Object.fromEntries(["/api", "/openapi.json"].map((path) => [path, { target: backend }]))
    : undefined;

  return {
    base: "./",
    plugins: [react()],
    server: { port: 5173, strictPort: true, ...(proxy ? { proxy } : {}) },
    preview: { port: 5173, strictPort: true, ...(proxy ? { proxy } : {}) },
    // The workspace package (the design system) is read from src, not dist — the "source" condition in
    // exports (paired with customConditions in apps/frontend/tsconfig.json). The shape of what ships is kept
    // by that package's build.
    resolve: { conditions: ["source", ...defaultClientConditions] },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      // No web fonts·external CDNs — only what is inside the build output is shipped. The logo PNG comes in via
      // import from assets/, not public/, so it gets a hashed name.
      sourcemap: false,
    },
  };
});
