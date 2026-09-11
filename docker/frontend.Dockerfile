# syntax=docker/dockerfile:1

# ── Build the browser bundle ──────────────────────────────────────────────────────────────────
# The build reads the VITE_* values through vite.config.ts (loadEnv merges the build environment
# with .env files) and Vite writes them into the JavaScript as literals. They are therefore fixed
# for the life of the image — docs/deployment.md: "VITE_AUTH_MODE is fixed when the Frontend is
# built". Changing one needs a rebuild, not a restart.
#
# Pass no secret as a build argument. An ARG value is recorded in the history of the stage that
# declares it, is printed in build output, and stays in the build cache. The published image here
# carries only the serving stage below, so it does not hold these values — but that is a property
# of this two-stage layout, not a guarantee about build arguments. Only VITE_* values belong here,
# and those are public by design: they are delivered to every browser inside the bundle.
#
# Node 24 (Active LTS) for the same reason as the Backend image: the CI matrix runs it. Nothing
# from this stage reaches the final image, so this version only has to build the bundle.
FROM node:24-alpine AS build

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /repo

# Manifests first so the install layer survives source edits. All four workspace manifests are
# needed: --frozen-lockfile compares the lockfile against the whole workspace, and the frontend
# depends on packages/design-system and (for types) apps/backend.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY packages/core/package.json packages/core/
COPY packages/design-system/package.json packages/design-system/

# The full install, not --prod: vite, the React plugin and typescript are what do the building.
RUN pnpm install --frozen-lockfile

COPY . .

ARG VITE_AUTH_MODE
ARG VITE_OIDC_ISSUER
ARG VITE_OIDC_CLIENT_ID
ARG VITE_OIDC_REDIRECT_URI
ARG VITE_OIDC_POST_LOGOUT_REDIRECT_URI
ARG VITE_OIDC_SCOPES
ARG VITE_OIDC_AUDIENCE

# vite.config.ts refuses an absent or unrecognised VITE_AUTH_MODE, so a missing profile fails here
# rather than producing a bundle that cannot decide how to authenticate. The design system is read
# from source through its "source" export condition, so it needs no build of its own.
RUN pnpm --filter @canton-lens/frontend build

# ── Serve it ──────────────────────────────────────────────────────────────────────────────────
# This stage carries no Node, no pnpm and no source — only the built files and nginx. nginx also
# forwards the Backend-owned routes, which is the job Vite performs during development.
FROM nginx:1.29-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/frontend/dist /usr/share/nginx/html
