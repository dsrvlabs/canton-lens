# Deployment

Explorer ships an independently runnable React Frontend and JSON Backend API. Select the
authentication profile explicitly; missing, invalid, or mismatched modes fail at build or startup.
There is no automatic fallback.

## Authentication profiles

| Frontend `VITE_AUTH_MODE` | Backend `LEDGER_AUTH_MODE` | Canton credential |
|---|---|---|
| `browser-oidc` | `caller-bearer` | Per-user token held in Browser memory |
| `shared-identity` | `shared-identity` | One shared token held by the Backend |

`VITE_AUTH_MODE` is fixed when the Frontend is built. `LEDGER_AUTH_MODE` and
`SHARED_IDENTITY_*` are read when the Backend starts.

### Browser OIDC

Use this profile when each user can sign in through an OIDC public client and receive an access
token accepted by Canton. The Browser uses Authorization Code with PKCE S256, keeps the access
token only in memory, and sends it with each `/api/*` request. The Backend forwards the token to
Canton without storing, refreshing, or exchanging it.

```dotenv
# apps/frontend/.env
VITE_AUTH_MODE=browser-oidc
VITE_OIDC_ISSUER=https://issuer.example
VITE_OIDC_CLIENT_ID=explorer-browser
VITE_OIDC_REDIRECT_URI=https://explorer.example/
VITE_OIDC_POST_LOGOUT_REDIRECT_URI=https://explorer.example/
VITE_OIDC_SCOPES=openid profile
# VITE_OIDC_AUDIENCE=https://canton.example

# Development only
BACKEND_PROXY_TARGET=http://localhost:7600

# apps/backend/.env
LEDGER_AUTH_MODE=caller-bearer
LEDGER_BASE=https://canton.example
API_HOST=127.0.0.1
API_PORT=7600
PUBLIC_ENTRY_URL=https://explorer.example/
```

The issuer must support OIDC Discovery, PKCE, and browser CORS for the required endpoints. It
must issue an access token with the audience and claims expected by Canton. Do not configure a
client secret in the Frontend. Keep every `SHARED_IDENTITY_*` variable unset in this mode.

### Shared Identity

Use this profile when every Explorer user may share one Canton service identity. The Browser
sends no Bearer token. The Backend uses Client Credentials to obtain and cache one token in
process memory.

```dotenv
# apps/frontend/.env
VITE_AUTH_MODE=shared-identity
BACKEND_PROXY_TARGET=http://localhost:7600

# apps/backend/.env
LEDGER_AUTH_MODE=shared-identity
LEDGER_BASE=https://canton.example
API_HOST=127.0.0.1
API_PORT=7600
SHARED_IDENTITY_ISSUER=https://issuer.example
SHARED_IDENTITY_CLIENT_ID=explorer-service
SHARED_IDENTITY_CLIENT_SECRET=replace-with-secret
SHARED_IDENTITY_SCOPES=ledger.read
# SHARED_IDENTITY_AUDIENCE=https://canton.example
```

Remove all `VITE_OIDC_*` values from the Frontend. Keep the client secret in Backend-only
configuration or a secret manager. The issuer and discovered token endpoint require HTTPS,
except for explicit loopback development, or a host named in
`SHARED_IDENTITY_INSECURE_HTTP_HOSTS` — a development allowance for a Backend that runs in a
container and therefore cannot reach a local stack through a loopback name. See
[Shared Identity against a local stack](#shared-identity-against-a-local-stack).

Shared Identity does not authenticate individual users. Everyone sees the same Canton scope, so
protect the Explorer with operator-managed access control. Incoming `/api/*` Authorization
headers are rejected with `409`; a caller credential cannot replace the configured identity.

Tokens and OIDC Discovery metadata are cached per Backend process. Restart every Backend
instance after changing the client secret, issuer, or scopes. Revoking a client secret may not
revoke tokens that have already been issued.

### Institution BFF

For per-user access without a Canton token in Browser JavaScript, build the Frontend with
`VITE_AUTH_MODE=institution-bff` and run the Backend with `LEDGER_AUTH_MODE=caller-bearer`.
The institution supplies and operates the BFF; Explorer does not include a proxy, login,
server-side session, or token-exchange implementation.

The BFF must validate the user's session, replace any Browser Authorization header with that
user's Canton-compatible Bearer token, and forward `/api/*` to a private Explorer Backend. It
should forward `/openapi.json` without acquiring a user token. A missing session should return
`401` JSON such as `{"login":"/institution/login"}`, not redirect an API request to HTML.

Serve the Frontend and BFF through one browser origin. In development,
`BACKEND_PROXY_TARGET` points to the institution front rather than directly to the Backend.

## Preview the build locally

Build the Frontend:

```bash
pnpm build
```

Start the Backend:

```bash
pnpm --filter @canton-lens/backend start
```

In another terminal, serve the Frontend build at `http://localhost:5173/`:

```bash
pnpm --filter @canton-lens/frontend preview
```

`preview` is only for checking the production build locally. It is not a production server.

The Frontend build is written to `apps/frontend/dist/`. The Backend runs independently and does
not serve that directory. It currently runs TypeScript from the pnpm workspace, so run it from
the installed workspace; `pnpm deploy` is unsupported unless `packages/core` is first built to
JavaScript.

The Backend may also run without the Frontend. In `caller-bearer`, an API client supplies a
Canton-compatible Bearer token with every `/api/*` request. In `shared-identity`, callers send no
Bearer token and the Backend uses its configured shared credential.

## Docker

Two images behind one origin: nginx serves the built Frontend and forwards `/api/*` and
`/openapi.json` to the Backend, which publishes no port of its own. This is the route map under
[Production](#production), written as a compose file.

Compose v2 is required — the `docker compose` subcommand. The standalone `docker-compose` v1
script reads neither the top-level `name` nor a required `${VAR:?message}` variable, so it fails
on the compose file rather than starting a misconfigured deployment.

```bash
cp docker/.env.example docker/.env
chmod 600 docker/.env
docker compose -f docker/compose.yaml up -d --build
```

`docker/.env` carries every value and is not committed; `docker/compose.yaml` carries none, so no
tracked file is edited to configure a deployment. Compose reads `docker/.env` because the project
directory is the directory of the compose file. A required value that is missing stops Compose
before anything is built or started.

Where a value is read decides how it is changed.

| Value | Read at | Changing it needs |
|---|---|---|
| `VITE_*` | Frontend build | `up -d --build` — the value is a literal inside the bundle |
| `LEDGER_*`, `API_*`, `PUBLIC_ENTRY_URL`, `SHARED_IDENTITY_*` | Backend startup | `up -d` |

Names the compose file lists without a value are passed through only when set. An absent
`SHARED_IDENTITY_*` variable is not the same as an empty one: in `caller-bearer` mode the Backend
refuses to start when any of them is defined at all.

### The two containers

| Container | Holds | Port |
|---|---|---|
| `frontend` | nginx, the built bundle, `docker/nginx.conf.template`. No Node, no source | `EXPLORER_BIND`:`EXPLORER_PORT` → 80 |
| `backend` | Node 24, workspace source, production dependencies. No frontend assets | unpublished; reachable from `frontend` only |

The Backend image compiles nothing — Node runs the TypeScript in `apps/backend/src` and
`packages/core` as it stands. It starts `node apps/backend/src/live/serve.mjs` rather than
`pnpm start`, which reads an environment file that a container does not have.

`API_HOST` is `0.0.0.0` here rather than the loopback address of the committed example. Inside a
container the loopback address reaches only that container, and the Frontend would find nothing
listening; the process port itself stays unpublished.

### Shared Identity against a local stack

Shared Identity refuses to start unless the ledger and the issuer are reached over HTTPS. Loopback
addresses are exempt, and a container cannot use that exemption: inside a container a loopback name
reaches the container itself, while the address that does reach the host is not a loopback name.

`SHARED_IDENTITY_INSECURE_HTTP_HOSTS` names the hosts whose plaintext HTTP the Backend may use.
Hosts it does not name still require HTTPS, so a value left in place cannot cover a production
ledger, and startup prints a warning naming what was allowed. It is refused outright in
`caller-bearer` mode, which holds no service credential.

Two further conditions are not settled by this file:

- The IdP must advertise the address it is reached at. Discovery's `issuer` claim is compared with
  `SHARED_IDENTITY_ISSUER`, so an IdP answering on one address while advertising another is refused
  — including a local Keycloak that answers on the container-visible address and advertises
  `localhost`. Configure the IdP's own hostname.
- The ledger and the issuer must both be plaintext or both be TLS. The pairing exists so that a
  remote IdP over TLS cannot sit beside a ledger reached in the clear.

### Before exposing it

- `EXPLORER_BIND` defaults to `127.0.0.1`. The Frontend container terminates no TLS and enforces no
  access control. Put TLS, edge access control, and rate limiting in front of it before widening
  that value.
- Pass no secret as a build argument. A build argument is recorded in the history of the stage that
  declares it, printed in build output, and kept in the build cache.
  `SHARED_IDENTITY_CLIENT_SECRET` is read at startup instead and stays out of both images.
- Leave `BASE_PATH` unset. `docker/nginx.conf.template` serves the Explorer at the root; a prefix
  also needs matching `location` blocks in that file.
- nginx sends a Content-Security-Policy, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy` and `Permissions-Policy` on every answer (`docker/security-headers.conf`). The
  policy admits the bundle and the one inline script in `apps/frontend/index.html` by hash; after
  editing that script, rebuild and run `node docker/inline-script-hashes.mjs
  apps/frontend/dist/index.html`, then update the hash in the template. In `browser-oidc` the
  policy's `connect-src` is derived from `VITE_OIDC_ISSUER` at container start; a provider that
  serves its token endpoint from another host needs `CSP_CONNECT_SRC` in `docker/.env`.
- nginx forwards the `Authorization` header unchanged and makes no authentication decision. In
  `browser-oidc` the user's Canton token travels through it.
- Review the [security checklist](security.md#deployment-checklist).

## Production

- Serve `apps/frontend/dist/` from the public origin and forward `/api/*` and `/openapi.json` to
  the Backend.
- Send the same response headers the Docker image sends (`docker/security-headers.conf` and the
  policy in `docker/nginx.conf.template`), adjusted to the host that serves them.
- Use HTTPS, edge access controls, and rate limiting. Keep the Backend process port on loopback
  or a protected private network where possible.
- Keep tokens, secrets, Authorization headers, and ledger response bodies out of logs and traces.
- Grant the selected Canton identity only the rights it needs.
- Review the [security checklist](security.md#deployment-checklist) before deployment.
