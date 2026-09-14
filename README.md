<h1 align="center">Canton Lens</h1>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg"></a>
  <img alt="Node 22.18+" src="https://img.shields.io/badge/node-22.18%2B-brightgreen.svg">
  <img alt="pnpm 9" src="https://img.shields.io/badge/pnpm-9-f69220.svg">
  <img alt="Canton 3.5" src="https://img.shields.io/badge/Canton-3.5-4b3fd6.svg">
</p>

<p align="center">A private explorer for Canton participant ledgers, scoped to the selected Canton identity's permissions.</p>

<p align="center">
  <img src="docs/images/overview-dark.png" alt="Canton Lens dashboard showing ledger activity, three parties, 39 active contracts, pending offers, and recent transactions." width="1200">
</p>

<p align="center"><sub>Actual application screens using recorded local-development data.</sub></p>

Public-chain explorers show everyone the same ledger. A Canton participant's ledger is
private and permissioned: two Canton identities on the same participant may legitimately see
different contracts. Canton Lens leaves those visibility decisions to Canton
and presents only the data returned for the selected identity.

## Features

- **Permission-Scoped:** Every ledger-data request uses the selected user or service token, so the
  Canton participant decides which transactions, contracts, parties, and tokens are visible.
- **Canton-Native:** Investigate transactions and contracts across multiple parties, inspect
  Splice token activity, and browse installed Daml-LF packages and templates.
- **UI and API:** Use the included React explorer or integrate with its documented Backend API.
  An OpenAPI document is available at `/openapi.json`.
- **Flexible authentication:** Use Backend-managed Client Credentials for a shared Canton
  identity, or Browser OIDC for per-user access. Shared-identity credentials remain
  Backend-only, and issued tokens are cached only in memory.

## Explore

| View | What you can inspect |
| --- | --- |
| **Overview** | Ledger position, visible contracts, token kinds, pending offers, and recent activity at one snapshot offset. |
| **Transactions & contracts** | Update events, active contract payloads, signatories, observers, and decoded template fields and choices. |
| **Parties & tokens** | Party relationships, Splice token holdings, transfer instructions, and preapprovals. |
| **Timeline** | Contract creation and archival across a selected range of ledger offsets. |
| **Developer tools** | Installed Daml-LF packages, template definitions, participant status, and the OpenAPI document. |

<table>
  <tr>
    <td width="50%"><a href="docs/images/contracts.png"><img src="docs/images/contracts.png" alt="Active contracts with template and party filters, creation times, and contract IDs."></a></td>
    <td width="50%"><a href="docs/images/timeline.png"><img src="docs/images/timeline.png" alt="Transfer offer contract lifetimes plotted against ledger offsets, including active and archived contracts."></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Inspect active contracts</strong><br><sub>Filter by template and party, then open a contract.</sub></td>
    <td align="center"><strong>Trace contract lifetimes</strong><br><sub>See where contracts begin and end on the ledger.</sub></td>
  </tr>
</table>

Recent activity and timeline views cover bounded offset ranges. Data pruned by the participant is not recovered by the explorer.

The Explorer reads the JSON Ledger API and nothing else. That API serves current state and a recent
window of updates, so older history and full-text search are outside what these screens can answer.
Serving those needs a separate store fed from the ledger, such as a Participant Query Store, which
this project does not integrate.

## Choose your authentication setup

Run the Explorer with its UI, or use the Backend API on its own.

### With the Explorer UI

For a direct deployment, choose one of these profiles. Missing or invalid configuration
fails closed; there is no automatic fallback or mode inference.

| Frontend `VITE_AUTH_MODE` (build time) | Backend `LEDGER_AUTH_MODE` (startup) | Identity |
|---|---|---|
| `browser-oidc` | `caller-bearer` | Individual user, Browser PKCE access token |
| `shared-identity` | `shared-identity` | One shared Canton service identity, Backend Client Credentials |

Rebuild the Frontend to change `VITE_AUTH_MODE`; restart the Backend to change
`LEDGER_AUTH_MODE` or `SHARED_IDENTITY_*`. Caller-bearer needs no Backend OIDC settings and
refuses leftover shared-identity configuration. See
[Shared Identity deployment](docs/deployment.md#shared-identity) for server-only configuration and
rotation.

For per-user access without exposing a Canton token to Browser JavaScript, use the
[`institution-bff` profile](docs/deployment.md#institution-bff).

### Backend API only

The Backend can also run without the Frontend. In this case, `VITE_AUTH_MODE` does not apply.

| Backend `LEDGER_AUTH_MODE` | Credential path |
|---|---|
| `caller-bearer` | The API client sends a Canton-compatible Bearer token with each `/api/*` request |
| `shared-identity` | The client sends no Bearer token; the Backend obtains one shared token with Client Credentials |

> Shared Identity Mode does not authenticate individual users. Every request is executed using
> one configured Canton service identity. The operator is responsible for controlling access to
> the Explorer. Every user sees the same Lens; never expose this API without operator-managed
> access control.

## Runtime boundaries

The repository is split into independently runnable parts:

| Part | Owns | Does not own |
|---|---|---|
| [`apps/frontend/`](apps/frontend/) | React UI, routing, and optional Browser OIDC login | Direct ledger access, server secrets, backend sessions |
| [`apps/backend/`](apps/backend/) | HTTP API, OpenAPI, and optional shared-identity token management | HTML, CSS, frontend assets, user login/sessions |
| [`packages/core/`](packages/core/) | Pure ledger-domain logic: identifier matching, visibility filtering, lag and balance computation; zero runtime dependencies | HTTP, authentication, anything that runs in a browser |
| [`packages/design-system/`](packages/design-system/) | Design tokens and domain-free React primitives | Ledger, API and authentication knowledge |

The authentication profile determines where the Canton credential comes from. In
`caller-bearer` mode, each request carries a per-user token supplied by the caller. In
`shared-identity` mode, the Browser sends no token; the Backend uses a server-held client ID
and secret to obtain and cache one shared Canton token.

## Deploy with Docker

Two containers behind one origin: nginx serves the built UI and forwards `/api/*` and
`/openapi.json` to the Backend. Node and pnpm are needed only inside the build.

Requires Docker Compose v2 — the `docker compose` subcommand, not the standalone
`docker-compose` v1 script, which reads neither the top-level `name` nor a required
`${VAR:?message}` variable.

```bash
cp docker/.env.example docker/.env
chmod 600 docker/.env
docker compose -f docker/compose.yaml up -d --build
```

Every value lives in `docker/.env`, which is not committed; the compose file holds none. The
published port binds to loopback by default — the containers terminate no TLS and enforce no
access control. See [Docker](docs/deployment.md#docker).

## Quick start

You need Node.js 22.18 or newer, pnpm 9, and a Canton participant reachable through JSON
Ledger API v2. Browser OIDC also needs an issuer with a public client registered for the
Explorer. This repository starts neither the participant nor the issuer. Install the
dependencies first:

```bash
corepack enable
pnpm install --frozen-lockfile
cp apps/frontend/.env.example apps/frontend/.env
cp apps/backend/.env.example apps/backend/.env
```

Configure one matching profile in the copied files:

**Browser OIDC** — per-user browser login

```dotenv
# apps/frontend/.env
VITE_AUTH_MODE=browser-oidc
VITE_OIDC_ISSUER=https://issuer.example
VITE_OIDC_CLIENT_ID=explorer-browser

# apps/backend/.env
LEDGER_AUTH_MODE=caller-bearer
LEDGER_BASE=https://canton.example
```

**Shared Identity** — one Backend-managed Canton identity

```dotenv
# apps/frontend/.env
VITE_AUTH_MODE=shared-identity

# apps/backend/.env
LEDGER_AUTH_MODE=shared-identity
LEDGER_BASE=https://canton.example
SHARED_IDENTITY_ISSUER=https://issuer.example
SHARED_IDENTITY_CLIENT_ID=explorer-service
SHARED_IDENTITY_CLIENT_SECRET=replace-with-secret
SHARED_IDENTITY_SCOPES=ledger.read
```

For Shared Identity, remove the unused `VITE_OIDC_*` values from `apps/frontend/.env`.

The Explorer does not select a profile or fall back to another one automatically. See
[Browser OIDC](docs/deployment.md#browser-oidc) or
[Shared Identity](docs/deployment.md#shared-identity) for provider configuration and production
requirements.

Then start the frontend and backend in separate terminals:

```bash
pnpm dev:backend       # JSON API :7600, no authentication proxy
pnpm dev:frontend      # frontend :5173
```

Open `http://localhost:5173/`.

Before production, review the [deployment guide](docs/deployment.md) and
[security boundaries](docs/security.md) for the selected profile.

## Documentation

| Document | Contents |
|---|---|
| [Deployment](docs/deployment.md) | Authentication profiles, configuration, and production hosting |
| [Security](docs/security.md) | Token boundaries, ledger rights, and deployment checklist |
| [Development](docs/development.md) | Repository layout, commands, and tests |

## Contributing

Issues and pull requests are welcome. Before opening a PR, run:

```bash
pnpm typecheck
pnpm lint
pnpm openapi:check
pnpm test
```

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
