import { Section, SectionBody } from "@canton-lens/design-system";
import { type ReactNode, useSyncExternalStore } from "react";
import type { BrowserOidcAuth } from "./browser-oidc.ts";

export function AuthBoundary({ auth, children }: { auth: BrowserOidcAuth; children: ReactNode }) {
  const state = useSyncExternalStore(auth.subscribe, auth.getSnapshot);
  if (state.status === "authenticated") return children;
  const busy = state.status === "loading";
  return (
    <main className="signin-page">
      <p className="signin-brand">Canton Lens</p>
      <Section className="signin-card" aria-labelledby="signin-title">
        <SectionBody>
          <h1 id="signin-title">{busy ? "Completing authentication…" : "Sign in required"}</h1>
          <p className="clds-muted" role="status">
            {state.message ?? "Sign in with your identity provider to continue."}
          </p>
          <button
            type="button"
            className="clds-button clds-button--primary clds-button--md signin-action"
            disabled={busy}
            onClick={() => void auth.login()}
          >
            Continue to sign in
          </button>
        </SectionBody>
      </Section>
    </main>
  );
}
