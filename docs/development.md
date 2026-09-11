# Development

## Repository layout

```text
apps/frontend/          Vite + React UI
apps/backend/           Fastify JSON API and OpenAPI document
packages/core/          Pure ledger-domain logic, zero runtime dependencies
packages/design-system/ Design tokens and domain-free React components
docker/                 Deployment images, compose file, and nginx route map
```

`docker/` is a deployment path, not a development one: the containers build from the workspace
and read no `apps/*/.env`. See [Docker](deployment.md#docker).

The Frontend consumes HTTP responses and owns presentation and Browser OIDC. The Backend owns
transport and optional Shared Identity credentials. `packages/core` contains pure computation
and does not depend on HTTP or authentication.

## Commands

```bash
pnpm dev:frontend
pnpm dev:backend
pnpm build
pnpm typecheck
pnpm lint
pnpm openapi:check
pnpm test
```

The development processes are independent. The Frontend requires `apps/frontend/.env`; the
Backend requires `apps/backend/.env`. Vite forwards `/api/*` and `/openapi.json` to the configured
`BACKEND_PROXY_TARGET`. The Backend does not serve `apps/frontend/dist/`.

## Contributing rules

- Keep `packages/core` free of runtime dependencies.
- Do not add ledger writes without an explicit security design.
- Preserve unavailable and denied states; do not turn failures into `0`, `[]`, or `null`.
- Keep visibility decisions at one boundary rather than repeating them in screens or routes.
- Retain `.ts` extensions in relative TypeScript imports.
- Use erasable TypeScript syntax; avoid `enum`, `namespace`, and parameter properties.
- Update `apps/frontend/src/api/types.ts` and the generated OpenAPI schema when Backend response
  types change.

Before opening a pull request, run:

```bash
pnpm typecheck && pnpm lint && pnpm openapi:check && pnpm test
```

CI covers domain logic, recorded API responses, authentication transports, configuration
failures, type checking, linting, and OpenAPI drift. Verification against a real IdP and Canton
participant remains a deployment responsibility.
