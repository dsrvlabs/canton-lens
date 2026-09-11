import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { AuthBoundary } from "./auth/AuthBoundary.tsx";
import { readAuthConfig } from "./auth/config.ts";
import { configureAuth } from "./auth/runtime.ts";
// The design system comes first — the product's own shell (styles.css) is laid over the tokens
// and primitives.
import "@canton-lens/design-system/styles.css";
import "./styles.css";

const root = document.getElementById("root");
if (root) {
  try {
    const auth = configureAuth(readAuthConfig(import.meta.env, location.href));
    // initialize synchronously scrubs callback parameters before rendering the application.
    if (auth) void auth.initialize();
    createRoot(root).render(
      <StrictMode>
        {auth ? (
          <AuthBoundary auth={auth}>
            <App />
          </AuthBoundary>
        ) : (
          <App />
        )}
      </StrictMode>,
    );
  } catch {
    // Configuration errors must not turn into an institution-bff fallback or expose configured values.
    history.replaceState(null, "", location.pathname);
    root.textContent = "Authentication configuration is invalid. Contact your administrator.";
  }
}
