// Authentication belongs to an outside service. When the server says "sign in again" with a 401, draw one way
// out instead of a broken shell.
// Only the address the server gave is used (a value that passed through safeHttpUrl in client.ts) — none is
// invented here.
import { Section, SectionBody } from "@canton-lens/design-system";

export function SignInRequired({ entryUrl }: { entryUrl: string | null }) {
  return (
    <main className="signin-page">
      <p className="signin-brand">Canton Lens</p>
      <Section className="signin-card" aria-labelledby="signin-title">
        <SectionBody>
          <h1 id="signin-title">Sign in required</h1>
          <p className="clds-muted">Sign in through your organization’s service to continue.</p>
          {entryUrl ? (
            <>
              {/* A link that looks like a button — it wears the design system's button classes as is
                (Button only makes a <button>). */}
              <a
                className="clds-button clds-button--primary clds-button--md signin-action"
                href={entryUrl}
              >
                Continue to sign in
              </a>
              <a className="signin-url clds-mono" href={entryUrl}>
                {entryUrl}
              </a>
            </>
          ) : (
            <p className="clds-muted signin-help">
              Open Canton Lens from its usual service page, or ask your administrator for the
              correct address.
            </p>
          )}
        </SectionBody>
      </Section>
    </main>
  );
}
