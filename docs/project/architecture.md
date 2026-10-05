# Architecture

## What this is

Veent WiFi Portal is a MikroTik captive WiFi portal business.

- Guests buy WiFi time on a captive portal. They log in with a phone OTP and pay with Maya.
- Staff run operations in an admin dashboard.
- A public map shows hotspot sites.

## Apps and packages

Monorepo. Package manager: bun workspaces (`apps/*`, `packages/*`).

| Package        | Path             | Purpose                                                                                                              |
| -------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| veent-customer | `apps/customer/` | Captive portal. Guest phone-OTP login, top-ups (Maya), free and paid time grants, SMS OTP.                           |
| radius-admin   | `apps/admin/`    | Staff dashboard. Networks/APs, finance, incident management (issues), staff and 2FA, Sentry views.                   |
| veent-locator  | `apps/locator/`  | Public read-only Leaflet map of hotspots. No auth.                                                                   |
| @veent/core    | `packages/core/` | Shared business services, integration providers (network, payments, email), Sentry helpers, business-rule constants. |
| @veent/db      | `packages/db/`   | The only Drizzle/Postgres schema. One migration authority for all apps.                                              |

## Repo structure

```text
veent_wifiportal/
  apps/
    admin/      src/, e2e/, scripts/, static/, playwright.config.ts
    customer/   src/, loadtest/, scripts/, static/, playwright.config.ts
    locator/    src/, static/, playwright.config.ts
  packages/
    core/       src/, scripts/
    db/         src/, drizzle/ (53 migrations)
  docs/         architecture, deploy, design, mikrotik, runbooks, use-cases, ...
  scripts/      dev-cron.ts, idempotent-migrations.ts, setup-prod.ts
  process/      old agent-harness files and read-only plan history
  .github/      CI workflows
  .githooks/    pre-push hook
```

Notes:

- No `apps/cron` package. See "Cron" below.
- No `svelte.config.js` in any app. SvelteKit config is inline in each app's `vite.config.ts`, inside the `sveltekit({...})` plugin options.
- Entry points: `apps/{admin,customer,locator}/src/hooks.server.ts` and `hooks.client.ts`. They init Sentry. Admin and customer also run `validateEnv()` at boot.
- All three apps use `@sveltejs/adapter-node`. `bun run build` writes `build/index.js`. Start it with `node build`.

### Cron

Cron has two parts.

1. In production, an external scheduler calls HTTP endpoints. Each endpoint checks an `x-cron-secret` header:
   - `apps/customer/src/routes/api/network/revoke`
   - `apps/customer/src/routes/api/payments/reconcile`
   - `apps/customer/src/routes/api/otp/sweep-delivery`
   - `apps/admin/src/routes/api/network/health/refresh`
2. In dev, `scripts/dev-cron.ts` polls those endpoints (`bun run dev:cron`).

Trap: `dev-cron.ts` uses one global 1-minute interval. `otp/sweep-delivery` is meant to run every 5 minutes (`Sentry.withMonitor` schedule `*/5 * * * *`). Set the real 5-minute schedule on the external production scheduler. Do not copy dev-cron's interval. The sweep's reject-alert path has no atomic claim. Overlapping runs could alert one row twice. This is avoided by using one external scheduler, not by a lock.

## Tech stack

Versions from `bun.lock`.

| Area            | Choice                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Runtime         | bun 1.3.14 in CI (no `engines` or `.nvmrc` pin)                                                                                 |
| Framework       | `@sveltejs/kit` 2.65.1, `svelte` 5.56.3, `vite` 8.0.16                                                                          |
| Svelte mode     | Runes forced project-wide (`compilerOptions.runes` predicate in each `vite.config.ts`)                                          |
| Styling         | `tailwindcss` 4.3.1 with `@tailwindcss/vite`, plus `@tailwindcss/typography`                                                    |
| Database        | `drizzle-orm` 0.45.2, `postgres` (postgres.js) 3.4.9, `drizzle-kit` 0.31.10 (packages/db only)                                  |
| Auth            | `better-auth` 1.4.22, `@better-auth/cli`                                                                                        |
| Observability   | `@sentry/sveltekit` 10.62.0 (all apps), `@sentry/core` (packages/core)                                                          |
| UI libs         | `lucide-svelte` 1.0.1 (admin), `leaflet` 1.9.4 (admin, locator), `leaflet.markercluster` (admin)                                |
| Integrations    | `node-routeros` 1.6.9, `resend` 6.12.4, `uqr` 0.1.3 (admin 2FA QR). Maya is hand-rolled HTTP, no SDK.                           |
| Testing         | `vitest` 4.1.9, `@playwright/test` 1.61.0, `@vitest/browser-playwright`, `vitest-browser-svelte`, `@electric-sql/pglite` 0.2.17 |
| Lint and format | `eslint` 10.5.0 (flat config), `eslint-plugin-svelte`, `prettier` 3.8.4 (svelte and tailwind plugins)                           |
| Types           | `typescript` 6.0.3, `svelte-check`                                                                                              |

## Key code patterns

**Errors.**

- Form actions: `fail(status, data)` for validation errors.
- Navigation: `redirect()`.
- External calls (SMS, Maya): wrap in `try/catch`. An outage becomes `fail()`, not a 500.
- Hard HTTP errors in `+server.ts` and `load`: `error()`.

**Server-only code.** It lives in `$lib/server/` per app. Admin also has `$lib/server/emails/` and `$lib/server/sentry/`.

**Form actions.** Order: validate, check rate limit, call external service (in `try/catch`), then `fail()` or `redirect()`.

**Audit trail (admin issues).** Every mutation runs in `db.transaction(tx)`. A private `recordEvent(tx, ...)` adds an `admin_issue_event` row in the same transaction. Never log in a fire-and-forget write.

**Unique-violation check.** drizzle-orm wraps driver errors in `DrizzleQueryError`. The Postgres code (for example `23505`) is on the `.cause` chain, not on the caught error. Read `err.code ?? err.cause?.code ?? err.cause?.cause?.code`. Never match the message text. The constraint-name field differs: postgres.js uses `constraint_name`, PGlite uses `constraint`. Check both. Examples:

- `packages/core/src/services/reconcilePayments.ts` (tested in `apps/customer/src/lib/server/record-payment.spec.ts`)
- `packages/core/src/services/networkHealth.ts` (`isNameUniqueViolation`)

Reuse this pattern. Background: `process/general-plans/completed/ap-name-collision-retry_20-07-26/`.

**Rate limiting.** `packages/core/src/services/rateLimit.ts` exports `consumeRateLimit(db, {key, max, windowMs})`. It is a Postgres sliding window. It is race-safe (`INSERT ... ON CONFLICT` plus `SELECT FOR UPDATE` in a transaction). Each app has thin wrappers:

- `apps/admin/src/lib/server/{rateLimit,emailRateLimit}.ts`
- `apps/customer/src/lib/server/{rateLimit,otpRateLimit}.ts`

**Integration factories.** `@veent/core` has `integrations/{network,payments,email}`. Each has a real provider (mikrotik, maya, resend) and a `stub.ts`. Env selects one. `observability.ts` `traceMethods()` wraps provider methods with `startSpan`. `scrubEvent` is the shared PII redactor. It drops secrets and masks emails, MACs, and phones. Each app wires it into Sentry `beforeSend`.

**Route layout.**

- Admin: `(app)/` route group holds authed routes (content, dashboard, finance, issues, map, networks, profile, sentry, staff, users). Public routes sit outside it (login, login/2fa, forgot-password, reset-password, enroll-2fa, activate, logout, docs, sentry-test).
- Customer: flat. dashboard, top-up, auth/handoff, auth/verify, login, faq, library, plus captive-probe endpoints (`hotspot-detect.html`, `generate_204`, `gen_204`, `ncsi.txt`, `connecttest.txt`).
- Components: PascalCase `.svelte` files. See `ui.md`.

**Import aliases.** Only SvelteKit's `$lib` -> `src/lib` per app. `@veent/core` and `@veent/db` are bun workspace packages with subpath exports:

- `@veent/core`: `.`, `./services`, `./integrations`, `./observability`
- `@veent/db`: `.`, `./schema`

Env access uses `$env/dynamic/private` and `$env/dynamic/public` (read at runtime, not inlined at build).

## Cross-app boundaries

- Customer and admin never import each other. They share only `@veent/db` and `@veent/core`.
- One Postgres holds `customer_*` and `admin_*` tables plus shared `rate_limits`, `network_health`, and `customer_otp_delivery_log`.
- Shared `@veent/core` services: accounts, credits, points, sessions, staff, adminAccess, checkoutAccess, outage, reconcilePayments, rateLimit, settings, networkHealth, freeTime.
- Two separate `betterAuth()` instances. See `auth.md`. Never join them.
- Admin has network-level access hints (`ADMIN_WG_HOSTS`, `ADMIN_WG_IPS`). They are walled-garden inputs, not auth. See `auth.md`.

## Environment and config

Real `.env` files are git-ignored. Each app has a `.env.example`.

Config files: `packages/db/drizzle.config.ts`, per-app `vite.config.ts`, `compose.yaml` (local Postgres via `bun run db:start`).

Env var names (no values):

`apps/customer/.env.example`

- Core: `DATABASE_URL`, `ORIGIN`, `TUNNEL_ORIGIN`
- Auth: `BETTER_AUTH_SECRET`
- Network: `NETWORK_CONTROLLER`, `MIKROTIK_HOST`, `MIKROTIK_USER`, `MIKROTIK_PASSWORD`, `MIKROTIK_PORT`, `MIKROTIK_TLS`, `MIKROTIK_TLS_INSECURE`, `MIKROTIK_HOTSPOT_USER`, `MIKROTIK_HOTSPOT_PASSWORD`
- Cron: `CRON_SECRET`, `CRON_IP_ALLOWLIST`
- Payments: `MAYA_PUBLIC_KEY`, `MAYA_SECRET_KEY`, `MAYA_SANDBOX`
- Test mode: `TEST_MODE`, `ALLOW_TEST_MODE_IN_PROD`
- SMS: `SMS_PROVIDER`, `CAST_API_KEY`, `CAST_SENDER_ID`, `ITEXMO_API_CODE`, `ITEXMO_EMAIL`, `ITEXMO_PASSWORD`, `ITEXMO_SENDER_ID`, `UNISMS_SECRET_KEY`, `UNISMS_SENDER_ID`, `SMSGATE_BASE_URL`, `SMSGATE_USERNAME`, `SMSGATE_PASSWORD`

`apps/admin/.env.example`

- Core: `DATABASE_URL`, `ORIGIN`
- Auth: `BETTER_AUTH_SECRET`
- Network: `NETWORK_CONTROLLER`, `MIKROTIK_HOST`, `MIKROTIK_USER`, `MIKROTIK_PASSWORD`, `MIKROTIK_PORT`, `MIKROTIK_TLS`, `MIKROTIK_TLS_INSECURE`, `MIKROTIK_WAN_INTERFACE`, `MIKROTIK_HOTSPOT_USER`, `MIKROTIK_HOTSPOT_PASSWORD`, `HEALTH_EXCLUDE_INTERFACES`
- Walled garden / WireGuard: `ADMIN_WG_HOSTS`, `ADMIN_WG_IPS`
- Cron: `CRON_SECRET`
- Email: `RESEND_API_KEY`, `EMAIL_FROM`
- Owner bootstrap: `OWNER_EMAIL`, `OWNER_PASSWORD`, `OWNER_NAME`
- Sentry: `PUBLIC_SENTRY_DSN`, `PUBLIC_SENTRY_ENVIRONMENT`, `SENTRY_ENVIRONMENT`, `PUBLIC_SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_TRACES_SAMPLE_RATE`, `PUBLIC_SENTRY_RELEASE`, `SENTRY_RELEASE`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG_SLUG`, `SENTRY_PROJECT_ID`

`apps/locator/.env.example`: `DATABASE_URL`, `ORIGIN`.

Boot validation: `apps/{customer,admin}/src/lib/server/validateEnv.ts` runs once from `hooks.server.ts`. In production it fails hard on missing required vars. In dev it only warns. `NETWORK_CONTROLLER=mikrotik` requires the `MIKROTIK_*` vars. Admin needs `BETTER_AUTH_SECRET` of 32 or more characters.

## Deployment

Read `docs/deploy/README.md`. It covers Docker production and bare-metal host, plus router, Sentry, and secrets references. `docs/DEPLOYMENT.md` and `docs/runbooks/deploy*.md` are stubs that point to it.

## Team and workflow

- Small team: humans plus AI agents.
- Branches: feature branches and PRs into `staging`. `staging` is the current frontier. There is no production deploy process yet.
- CI: `.github/workflows/ci.yml` runs on PRs to `staging` and `main`. Order: check, prettier (non-blocking), eslint, test, build, then admin e2e. `publish.yml` builds after merge.
- `.githooks/pre-push` runs `bun run test`. Enable it once per clone: `git config core.hooksPath .githooks`. Skip once with `git push --no-verify`.
- Commit messages use conventional prefixes (`feat`, `fix`, `docs`, ...).
- Browser-visible changes need an agent browser pass and a human check.
