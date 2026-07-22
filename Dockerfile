# syntax=docker/dockerfile:1
#
# Multi-stage build for the veent_wifiportal monorepo.
#
#   docker build --build-arg APP=admin    -t admin    .   # radius-admin      (PORT 3002)
#   docker build --build-arg APP=customer -t customer .   # veent-customer    (PORT 3001)
#   docker build --build-arg APP=locator  -t locator  .   # veent-locator     (PORT 3003)
#   docker build --target migrate         -t migrate  .   # one-shot db:migrate
#
# APP is a path segment under apps/ (admin|customer|locator). Each app uses
# @sveltejs/adapter-node → `bun run build` emits apps/<APP>/build/index.js, started with
# `node build`. vite ssr.noExternal bundles @veent/db + @veent/core INTO each build/, so the
# runtime image only needs build/ + a production node_modules (third-party externals) + the
# app package.json — never a host node_modules (bun recreates workspace links inside the image).
# Builds need NO secrets: validateEnv early-returns while `building`, and the Sentry source-map
# plugin only activates when SENTRY_AUTH_TOKEN+org+project are set.

ARG BUN_VERSION=1.3.14

# ── base: workspace manifests + FULL install (build toolchain present, cacheable) ──────────
FROM oven/bun:${BUN_VERSION}-slim AS base
WORKDIR /app
# Copy only manifests first so the install layer caches until a manifest/lockfile changes.
COPY package.json bun.lock ./
COPY apps/admin/package.json ./apps/admin/
COPY apps/customer/package.json ./apps/customer/
COPY apps/locator/package.json ./apps/locator/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
RUN bun install --frozen-lockfile

# ── migrate: one-shot drizzle-kit migrate (carries packages/db + drizzle-kit dev dep) ───────
# Kept OUT of the 3 app runtime images. depends_on db-healthy in compose; runs before the apps.
# Placed before `build` so `--target migrate` needs no APP arg even on the legacy builder.
FROM base AS migrate
COPY packages/db ./packages/db
WORKDIR /app/packages/db
# db:migrate = `drizzle-kit migrate`; reads drizzle.config.ts (schema + ./drizzle SQL) + DATABASE_URL.
CMD ["bun", "run", "db:migrate"]

# ── build: build ONE app selected by ARG APP ───────────────────────────────────────────────
FROM base AS build
ARG APP
RUN test -n "${APP}" || (echo "ERROR: build requires --build-arg APP=admin|customer|locator" && exit 1)
COPY . .
RUN bun run --filter "./apps/${APP}" build

# ── proddeps: production-only install (dev deps like vite/svelte/playwright pruned) ─────────
FROM oven/bun:${BUN_VERSION}-slim AS proddeps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/admin/package.json ./apps/admin/
COPY apps/customer/package.json ./apps/customer/
COPY apps/locator/package.json ./apps/locator/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
RUN bun install --frozen-lockfile --production

# ── runtime: slim node server for the selected app (default final stage) ────────────────────
FROM node:22-slim AS runtime
ARG APP
WORKDIR /app
ENV NODE_ENV=production
# Copy the WHOLE production workspace tree, not just root node_modules: bun uses an isolated
# store (node_modules/.bun) + per-workspace relative symlinks and does NOT hoist deps to a flat
# root, so the externalized deps the bundled build/ imports (node-routeros, resend, @sentry/*,
# postgres, better-auth, drizzle-orm, leaflet, …) only resolve when every workspace's node_modules
# symlink farm is preserved intact. --production already pruned dev deps from the store.
# ponytail: whole-tree copy over a per-app flat prune — bun's symlink store makes a flat prune unreliable.
COPY --from=proddeps /app ./
COPY --from=build /app/apps/${APP}/build ./apps/${APP}/build
WORKDIR /app/apps/${APP}
# Container port; compose overrides PORT per app (customer 3001 / admin 3002 / locator 3003).
ENV PORT=3000
EXPOSE 3000
# Reuse an existing route rather than adding a health endpoint. fetch() follows the login
# redirect, so a 30x→200 reads as "up"; any status <400 passes. Node 22 has global fetch.
# ponytail: no new /health route — `/` already proves the server is serving.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.status<400?0:1)).catch(()=>process.exit(1))"
CMD ["node", "build"]
