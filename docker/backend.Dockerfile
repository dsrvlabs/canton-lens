# syntax=docker/dockerfile:1

# The Backend has no build output. From Node 22.18.0 the runtime strips the types and runs the
# TypeScript in apps/backend/src and packages/core as they are, so this image carries workspace
# source plus production dependencies and compiles nothing. docs/deployment.md records the same
# constraint: `pnpm deploy` is unsupported unless packages/core is first built to JavaScript.
#
# Node 24 is the Active LTS line and one of the two majors the CI matrix runs, so the runtime here
# is one the test suite has walked. The major alone is pinned: patch releases carry the security
# fixes, and `engines` (>=22.18.0) states the floor rather than the version to deploy.
FROM node:24-alpine

# corepack takes the pnpm version from the root package.json "packageManager" field, so the image
# resolves the same pnpm as CI. The download prompt has no terminal to answer it here.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /repo

# Manifests before source: this layer changes only when a dependency changes, so the install below
# is reused across source edits. Every workspace manifest is copied, not just the Backend's — the
# lockfile describes the whole workspace and --frozen-lockfile refuses a workspace that differs
# from it. .npmrc carries ignore-scripts, engine-strict and prefer-frozen-lockfile.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY packages/core/package.json packages/core/
COPY packages/design-system/package.json packages/design-system/

# --prod leaves typescript, @types/node and the OpenAPI schema generator out of the runtime image.
# ajv still arrives, as a dependency of fastify's own validator rather than as a devDependency.
# The filter's trailing "..." adds the workspace packages the Backend reaches through a link
# (packages/core), whose .ts files Node reads through that link at startup.
RUN pnpm install --frozen-lockfile --prod --filter @canton-lens/backend...

# Only what the process reads. The frontend bundle is not here: this package never serves assets.
COPY packages/core packages/core
COPY apps/backend apps/backend

# `node` is an unprivileged account already present in the base image.
USER node

# The Backend answers this without a token and without reaching the ledger, so a healthy result
# means the process is listening — not that Canton is reachable. BASE_PATH shifts the path when set.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.API_PORT+(process.env.BASE_PATH??'')+'/openapi.json').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# `pnpm start` is deliberately not used. It runs Node with --env-file, a container has no such
# file, and Node then exits with code 9 before any of this code runs. Configuration arrives as
# real environment variables instead — the form apps/backend/src/live/serve.mjs documents.
CMD ["node", "apps/backend/src/live/serve.mjs"]
