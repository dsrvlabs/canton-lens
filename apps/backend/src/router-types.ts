// Input/output types of the router layer. packages/core is not modified; its types are imported and used as they are.

// This layer neither acquires nor retains credentials (see docs/security.md). Caller-bearer supplies
// a request-scoped user token from Browser PKCE or an institution front; Canton decides its validity.
// In shared-identity, the HTTP boundary supplies a non-null marker and its transport attaches the
// Backend-managed service token. The selected profile is explicit, with no exchange or fallback here.
export type RouterRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
  ledgerToken: string | null;
  // Parsed JSON body, present only on the one route that takes one (POST /api/exercise; see
  // docs/ledger-writes.md). `unknown` rather than a named shape because the body is caller-supplied
  // and is checked at the route, alongside every other caller-supplied value — a typed field here
  // would say it had already been judged.
  body?: unknown;
};

export type RouterResponse = {
  status: number;
  body: unknown;
};
