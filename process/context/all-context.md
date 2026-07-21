# veent-wifiportal - All Context

Last updated: 2026-07-21 (AP false-DOWN outage guard closed — added `docs/mikrotik/ap-liveness-bypass.md` runbook, static transaction-wrapping tripwire test; migration count unchanged at 49, no schema touched)

This file is the root context entrypoint for the repo.

Use it for two things:

1. quick routing to the right context pack or root file
2. broad architecture and repository understanding

Start here before loading deeper context files.

---

## Project Description

**Veent WiFi Portal** is a MikroTik captive-WiFi-portal business: guests buy WiFi time through a
captive portal (phone-OTP login, Maya payments), staff run operations through an admin dashboard,
and a public locator map shows hotspot sites. Monorepo with 3 SvelteKit apps + 2 shared packages:

| Package | Path | Purpose |
|---|---|---|
| veent-customer | `apps/customer/` | MikroTik captive WiFi portal — guest phone-OTP login, top-ups (Maya payments), free/paid time grants, SMS OTP delivery |
| radius-admin | `apps/admin/` | Staff dashboard — network/AP management, finance, incident management (issues), staff/2FA, Sentry-embedded observability |
| veent-locator | `apps/locator/` | Read-only public map (Leaflet) of hotspot locations — no auth, minimal app |
| @veent/core | `packages/core/` | Shared business services + integration providers (network/payments/email), Sentry observability helpers, business-rule constants |
| @veent/db | `packages/db/` | Sole Drizzle/Postgres schema source — single migration authority for all three apps' tables |

**Scope note (CLAUDE.md ~/.claude):** agent work on this project is scoped to `/admin` and its
dependencies/connected resources unless explicitly prompted otherwise.

---

## How This File Works (the `all-*.md` Convention)

Every `process/context/` directory has one `all-*.md` entrypoint that acts as an attachable quick router for that domain. This root file (`all-context.md`) is the top-level router. Context groups each have their own `all-{group}.md` entrypoint.

**The pattern:**

```text
process/context/
  all-context.md                      <-- THIS FILE: root router
  planning/
    all-planning.md                   <-- group router for planning
    example-simple-prd.md             <-- deep doc within the group
    example-complex-prd.md            <-- deep doc within the group
  tests/
    all-tests.md                      <-- group router for tests
    debugging-and-pitfalls.md         <-- deep doc within the group
    e2e-tests.md                      <-- deep doc within the group
  database/
    all-database.md                   <-- group router for database
    schema-guide.md                   <-- deep doc within the group
    migration-procedures.md           <-- deep doc within the group
```

**How agents use it:**

1. Agent reads `all-context.md` first (this file)
2. Finds the relevant context group from the routing tables below
3. Reads that group's `all-{group}.md` entrypoint
4. Only then loads the specific deep doc needed

This layered routing keeps context windows small. Never load the whole `process/context/` tree.

**What each `all-{group}.md` must contain:**

- Scope (what the group covers and does NOT cover)
- Read-when rules (when an agent should load this group)
- Quick procedures or decision rules
- Source paths (list of deeper docs in the group)
- Update triggers (when to refresh this group's content)
- Routing to deeper docs within the group

---

## Quick Start

For most substantial tasks:

1. read this file first
2. choose the smallest relevant root file or context group from the tables below
3. only then load deeper files

---

## Current Root Entry Points

<!-- The two tables below (Root Entry Points + Context Groups) are GENERATED from each
     context doc's frontmatter by `discover-context.mjs --emit-routing`. Do NOT hand-edit
     between the GENERATED markers — your edits will be overwritten on the next rebuild.
     To change a row, edit the owning doc's frontmatter (description / keywords) and re-emit.
     `--check-routing` fails lint if this block drifts from the frontmatter on disk. -->

<!-- GENERATED:routing -->
| File | Read when |
|---|---|
| `process/context/all-context.md` | any substantial planning, research, review, or implementation task |
| `process/context/auth/all-auth.md` | Two isolated better-auth instances (admin TOTP 2FA + customer phone-OTP), the auth-guard pattern, and schema codegen — the auth group entrypoint/router |
| `process/context/database/all-database.md` | Drizzle/Postgres schema, migrations, client setup, and shared cross-app tables — the database group entrypoint/router |
| `process/context/planning/all-planning.md` | Plan-shape calibration, planning conventions, and implementation-plan examples — the planning group entrypoint/router |
| `process/context/tests/all-tests.md` | Test runners, exact commands, the admin e2e throwaway-DB harness quirks, and known coverage gaps — the tests group entrypoint/router |
| `process/context/uxui/all-uxui.md` | Admin's ui/ design-system primitives, Tailwind 4 tokens, and Svelte 5 runes conventions — the uxui group entrypoint/router |

## Current Context Groups

| Group | Entry point | Scope |
|---|---|---|
| `auth/` | `process/context/auth/all-auth.md` | Two isolated better-auth instances (admin TOTP 2FA + customer phone-OTP), the auth-guard pattern, and schema codegen — the auth group entrypoint/router |
| `database/` | `process/context/database/all-database.md` | Drizzle/Postgres schema, migrations, client setup, and shared cross-app tables — the database group entrypoint/router |
| `planning/` | `process/context/planning/all-planning.md` | Plan-shape calibration, planning conventions, and implementation-plan examples — the planning group entrypoint/router |
| `tests/` | `process/context/tests/all-tests.md` | Test runners, exact commands, the admin e2e throwaway-DB harness quirks, and known coverage gaps — the tests group entrypoint/router |
| `uxui/` | `process/context/uxui/all-uxui.md` | Admin's ui/ design-system primitives, Tailwind 4 tokens, and Svelte 5 runes conventions — the uxui group entrypoint/router |
<!-- /GENERATED:routing -->

## Task Routing Table

| If the task involves... | Load first | Then load |
|---|---|---|
| architecture or stack questions | this file | Repository Structure / Technology Stack sections below |
| DB/schema/migration work | `all-context.md`, `database/all-database.md` | schema files under `packages/db/src/schema/` |
| auth/2FA/session work | `all-context.md`, `auth/all-auth.md` | `apps/{admin,customer}/src/lib/server/auth.ts` |
| UI/component/styling work | `all-context.md`, `uxui/all-uxui.md` | `apps/admin/src/lib/components/ui/` |
| test-running or test-writing | `all-context.md`, `tests/all-tests.md` | the specific test/e2e file |
| creating or reviewing a plan | `all-context.md`, `planning/all-planning.md` | the relevant PRD example plus active plan |
| incident-management or staff-governance feature work | `all-context.md` | `process/features/incident-management/` or `process/features/admin-staff-governance/` (see Feature Folders below) |

## Context Group Lifecycle

Context groups are durable knowledge domains, not feature folders.

Create a group when:

- a topic has 3+ durable docs
- a single doc exceeds roughly 800 lines with separable subtopics
- multiple agents repeatedly need only one slice of a large context file
- the topic maps to a stable operational domain (tests, infra, database, auth, UI, workflows, etc.)

Do not create a group when:

- the content is a temporary report
- the content is a plan or execution artifact
- the topic is feature-specific and belongs in `process/features/...`

Move or split one group at a time. Use `all-{group}.md` entrypoints. Run the `audit-context` skill after every context organization change.

## Naming Convention

There are no `README.md` files inside `process/context/`.

Canonical entrypoints use `all-*.md`:

- root: `process/context/all-context.md`
- group: `process/context/{group}/all-{group}.md`

Each `all-{group}.md` file should act as the attachable quick router for that domain:

- tell the agent what the group covers
- give quick procedures and decision rules
- route to smaller deeper files

## Context Update Protocol

When durable project knowledge changes:

1. update the smallest relevant context file
2. update this file if routing, ownership, naming, or groups changed
3. update the owning `all-{group}.md` entrypoint when a group exists
4. run `audit-context`

---

## Repository Structure

```text
veent_wifiportal/
├── apps/
│   ├── admin/            -- radius-admin: staff dashboard (src/, e2e/, scripts/, static/, playwright.config.ts)
│   ├── customer/         -- veent-customer: MikroTik captive WiFi portal (src/, loadtest/, scripts/, static/, playwright.config.ts)
│   └── locator/          -- veent-locator: public hotspot map, no auth (src/, static/, playwright.config.ts)
├── packages/
│   ├── core/              -- @veent/core: business services + integration providers (src/, scripts/)
│   └── db/                -- @veent/db: sole Drizzle/Postgres schema source (src/, drizzle/ ← 49 migrations)
├── docs/                   -- assets/, design/, dev/, mikrotik/, problems/, runbooks/, use-cases/
├── scripts/                 -- dev-cron.ts, idempotent-migrations.ts, setup-prod.ts, ...
├── process/                 -- this context/plan/development-protocol system
└── .githooks/
```

Notes:
- No `apps/cron` package. Cron = (a) HTTP endpoints hit by an EXTERNAL scheduler in prod
  (`apps/customer/src/routes/api/network/revoke`, `apps/customer/src/routes/api/payments/reconcile`,
  `apps/customer/src/routes/api/otp/sweep-delivery`, `apps/admin/src/routes/api/network/health/refresh`),
  each guarded by an `x-cron-secret` header; (b) `scripts/dev-cron.ts` at repo root — dev-only poller
  (`bun run dev:cron`) hitting those endpoints. GOTCHA: `dev-cron.ts` has a single global 1-minute
  interval — `otp/sweep-delivery` is designed for a 5-minute prod cadence
  (`Sentry.withMonitor(..., { schedule: { value: '*/5 * * * *' } })`) but dev fires it every minute;
  harmless (idempotent, wall-clock windows) but the real 5-minute schedule must be set on the
  external prod scheduler, not inferred from dev-cron's interval.
- No `svelte.config.js`/`.mjs` in any app — all SvelteKit config lives inline in each app's
  `vite.config.ts`, inside the `sveltekit({...})` plugin options.
- Entry points: `apps/{admin,customer,locator}/src/hooks.server.ts` + `hooks.client.ts` (Sentry
  init; admin+customer run `validateEnv()` at boot). All three apps use `@sveltejs/adapter-node`
  (`bun run build` emits `build/index.js`, started via `node build`).

## Technology Stack

Exact resolved versions from `bun.lock`:

- **Runtime:** bun (`bun.lock`; no `engines`/`.nvmrc` pin)
- **Framework:** `@sveltejs/kit` 2.65.1; `svelte` 5.56.3 (Svelte 5, runes forced project-wide via
  `compilerOptions.runes` in each `vite.config.ts`); `vite` 8.0.16; `@sveltejs/vite-plugin-svelte` ^7.1.2
- **Styling:** `tailwindcss` 4.3.1 (v4, `@tailwindcss/vite` plugin) + `@tailwindcss/typography`
- **Database:** `drizzle-orm` 0.45.2 (pinned identically everywhere); `postgres` (postgres.js) 3.4.9;
  `drizzle-kit` ^0.31.10 (packages/db devDep only)
- **Auth:** `better-auth` 1.4.22 (~1.4.21) + `@better-auth/cli`
- **Observability:** `@sentry/sveltekit` 10.62.0 (all 3 apps); `@sentry/core` 10.62.0 (packages/core only)
- **UI libs:** `lucide-svelte` 1.0.1 (admin); `leaflet` 1.9.4 (admin+locator); `leaflet.markercluster` ^1.5.3 (admin)
- **Integrations:** `node-routeros` 1.6.9 (packages/core, MikroTik API); `resend` 6.12.4 (packages/core);
  Maya payments = hand-rolled HTTP in `packages/core/src/integrations/payments/maya.ts` (no SDK);
  `uqr` 0.1.3 (admin 2FA QR)
- **Testing:** `vitest` 4.1.9; `@vitest/browser-playwright` ^4.1.8; `vitest-browser-svelte` ^2.1.1;
  `@playwright/test` 1.61.0; `svelte-check` ^4.6.0; `typescript` ^6.0.3;
  `@electric-sql/pglite` ^0.2.17 (in-memory Postgres for packages/core tests)
- **Lint/format:** `eslint` ^10.4.1 (flat config) + `eslint-plugin-svelte` ^3.19.0; `prettier` ^3.8.3
  + svelte + tailwindcss plugins
- **Package manager:** bun (workspaces: `apps/*`, `packages/*`)

## Key Patterns and Conventions

**Error handling:** SvelteKit `fail(status, data)` for form-action validation; `redirect()` for
navigation; `try/catch` around external calls (SMS, Maya) so downstream outage degrades to
`fail()` not a 500; `error()` in `+server.ts`/`load` for hard HTTP errors.

**Server-only code:** `$lib/server/` per app; admin additionally nests `$lib/server/emails/`,
`$lib/server/sentry/`.

**Form actions:** validate → rate-limit-check → external-call-with-try/catch → fail()/redirect().

**Audit-trail pattern (admin issues):** every mutation runs inside `db.transaction(tx)`; a private
`recordEvent(tx, ...)` appends an `admin_issue_event` row in the SAME transaction — never a
fire-and-forget log write.

**Unique-constraint-violation discriminator (drizzle cause-chain walk):** drizzle-orm wraps driver
errors in `DrizzleQueryError`, so a Postgres SQLSTATE (e.g. `23505` unique_violation) lives on the
bounded `.cause` chain, not on the caught error directly — walk `err.code ?? err.cause?.code ??
err.cause?.cause?.code` (2-3 levels deep is enough; never substring-match the error message). The
constraint-name field differs by driver: postgres.js exposes `constraint_name`, PGlite/
node-postgres-shaped errors expose `constraint` — check both. Canonical implementations:
`packages/core/src/services/reconcilePayments.ts:104-112` (unit-tested in
`apps/customer/src/lib/server/record-payment.spec.ts`) and
`packages/core/src/services/networkHealth.ts` (`isNameUniqueViolation`, added 20-07-26 for the AP
name-collision retry — see `process/general-plans/completed/ap-name-collision-retry_20-07-26/`).
Reuse this pattern rather than re-deriving the cause-chain shape for any new unique-violation
handling.

**Rate limiting:** `packages/core/src/services/rateLimit.ts` → `consumeRateLimit(db, {key, max,
windowMs})`, a Postgres sliding-window implementation that is race-safe (`INSERT ... ON CONFLICT`
+ `SELECT FOR UPDATE` in a transaction). Per-app thin wrappers:
`apps/admin/src/lib/server/{rateLimit,emailRateLimit}.ts`,
`apps/customer/src/lib/server/{rateLimit,otpRateLimit}.ts`.

**`@veent/core` integration factories:** `integrations/{network,payments,email}` each export a
real provider (mikrotik/maya/resend) plus a `stub.ts` fallback, selected by env. `observability.ts`
`traceMethods()` wraps provider methods at the factory seam with `@sentry/core` `startSpan`.
`scrubEvent` is the shared strict PII redactor (drops secrets; masks emails/MACs/phones), wired
into each app's Sentry `beforeSend`.

**Migrations:** `packages/db/drizzle.config.ts` is the single source of truth; schema lives in
`packages/db/src/schema/index.ts`; 49 `.sql` migrations in `packages/db/drizzle/` (newest:
`0048_lying_firedrake.sql` 2026-07-20, adds `customer_otp_delivery_log` for OTP delivery
observability — applied via direct `psql` DDL, not `db:push`, per the push-managed-dev-DB gotcha).
Root scripts proxy `db:push/generate/migrate/studio/seed` → `bun run --filter @veent/db`. GOTCHA:
dev DB is push-managed — see Gotchas below.

**Naming / route groups:** admin's `(app)/` route group wraps authed routes (content, dashboard,
finance, issues, map, networks, profile, sentry, staff, users); public/pre-auth routes sit outside
the group (login, login/2fa, forgot-password, reset-password, enroll-2fa, activate, logout, docs,
sentry-test). Customer app is flatter: dashboard, top-up, auth/handoff, auth/verify, login, plus
captive-probe endpoints (hotspot-detect.html, generate_204, gen_204, ncsi.txt, connecttest.txt).
UI: PascalCase `.svelte` files under `src/lib/components/ui/` (admin: 18 primitives + barrel
`index.ts`) + `components/feature/` + `components/layout/`.

**Import aliases:** only SvelteKit's `$lib` → `src/lib` per app (no custom aliases). `@veent/core`
and `@veent/db` are real bun-workspace packages (node_modules symlinks) with subpath exports —
`@veent/core`: `.`, `./services`, `./integrations`, `./observability`; `@veent/db`: `.`, `./schema`.
Env access via `$env/dynamic/private` and `$env/dynamic/public` (runtime, not build-inlined).

**No `svelte.config.js`:** none of the 3 apps has a `svelte.config.js`/`.mjs` — all SvelteKit
config lives inline in each app's `vite.config.ts`, inside the `sveltekit({...})` plugin options.

**Cross-app boundaries:** two separate `betterAuth()` instances — `apps/customer/src/lib/server/
auth.ts` (cookiePrefix `veent-portal`) vs `apps/admin/src/lib/server/auth.ts` (cookiePrefix
`radius-admin`); each reads its own `BETTER_AUTH_SECRET`. Schema via a shared `_auth-factory.ts`
builder → `auth-admin.ts` / `auth-customer.ts` in packages/db. No direct customer↔admin imports —
sharing happens only through `@veent/db` (single Postgres, `customer_*`/`admin_*` tables + shared
`rate_limits`, `network_health`, plus `customer_otp_delivery_log` — an append-only, no-unique-
constraint OTP send-attempt log, provider-agnostic columns but only Cast is swept — see "SMS / OTP
delivery observability" below) and `@veent/core` services (accounts, credits, points, sessions,
staff, adminAccess, checkoutAccess, outage, reconcilePayments, rateLimit, settings, networkHealth,
freeTime). Admin also has network-level isolation hints (`ADMIN_WG_HOSTS`/`ADMIN_WG_IPS` —
WireGuard).

## Integration Domains

These are routed as sections here rather than as separate context groups (deliberate choice —
each domain has too few durable docs to warrant its own group, but is important enough to be
easy to find).

### MikroTik / RouterOS
- `node-routeros` dependency (`packages/core`)
- `docs/mikrotik/*.md` (7 files) — RouterOS templating/config reference, including
  `ap-liveness-bypass.md` (added 21-07-26) — every new physical AP MAC must be
  `type=bypassed` in `/ip/hotspot/ip-binding` or the hotspot's `hs-unauth-to` rule rejects
  the router's ICMP to it and the admin dashboard reads a healthy AP as permanently DOWN
  (false-DOWN → risks freezing paid guests via outage auto-pausing). This is currently THE
  primary mitigation for that bug.
- `packages/core` probe/setup scripts
- `apps/admin/scripts/setup-router.ts`
- `apps/admin/src/routes/api/network/`
- Gotcha: RouterOS templating, walled-garden constraints, OS captive-probe endpoints, and CNA
  mini-browser behavior are easy to break during cleanups — see Gotchas below.
- Guard: `packages/core/src/services/networkHealth.transaction-tripwire.spec.ts` (static
  source-text test, added 21-07-26) fails if either admin call site of `refreshNetworkHealth`
  (`apps/admin/src/routes/(app)/networks/+page.server.ts`,
  `apps/admin/src/routes/api/network/health/refresh/+server.ts`) gets wrapped in
  `db.transaction(` — that would break the AP name-collision standalone-statement retry (see
  `network_health` note below). A code-level "never-freeze-on-never-up-AP" guard was found
  impossible as designed (`online_since`/`offline_since` are current-state stamps, not
  history — see `process/general-plans/backlog/ap-outage-false-down-code-safeguard_NOTE_21-07-26.md`);
  deferred, runbook is the shipped mitigation.

### Maya payments
- `packages/core/src/integrations/payments/maya.ts` — hand-rolled HTTP client, no SDK
- `apps/customer/src/lib/server/payments.ts` + `paymentWebhook.ts`
- `apps/customer/src/routes/api/webhooks/maya/payment-status`, `api/payments/reconcile`
- `docs/maya-do-webhook-relay.md`
- Dev webhooks: real sandbox webhooks reach local dev through a **registered ngrok tunnel** — do
  not assume localhost is unreachable from Maya's sandbox.

### Sentry observability
- `@sentry/sveltekit` in all 3 apps; `@sentry/core` in `packages/core`
- `apps/admin/src/lib/server/sentry/`
- Admin routes: `(app)/issues/**`, `(app)/sentry/**`
- PII scrubbing: shared `scrubEvent` redactor wired into each app's Sentry `beforeSend` (drops
  secrets, masks emails/MACs/phones)
- Error classification: `beforeSend` in `packages/core/src/observability.ts` downgrades
  `RouterUnreachableError` (thrown by both `withTimeout()` helpers in `mikrotik.ts`/`adminAccess.ts`
  on router-call timeout) to `event.level = 'warning'` instead of `error` — the cron
  `Sentry.withMonitor('customer-network-revoke')` check-in already alerts on the failure, so this
  is noise reduction, not silence; `scrubEvent` still runs on every branch.

### SMS / OTP delivery observability
- `customer_otp_delivery_log` (`packages/db/src/schema/customer.ts`, migration `0048`) — append-only
  OTP send-attempt log, no unique constraint; every provider writes a row on synchronous gateway
  accept (`apps/customer/src/lib/server/otp.ts`, `logDeliveryAttempt`, insert **must** be awaited
  inside its own try/catch — an un-awaited insert's rejection escapes as an unhandled promise
  rejection on the guest-login path, not just a missed log line).
- `apps/customer/src/routes/api/otp/sweep-delivery/+server.ts` (cron-only, `requireCron()`) — the
  ONLY provider with real DLR observability is **Cast** (`GET /api/v1/sms/status/{message_id}`);
  `itexmo`/`unisms`/`smsgate` rows are written (satisfy the `provider` discriminator) but never
  swept — unobservable by design, not a gap in this implementation. Alerts (`captureHandled`,
  constant-message Sentry fingerprint) fire only on `dlr_status === 'REJECTD'` / `status ===
  'undelivered'` within a 30-min window; unresolved rows age out to `unknown` with no alert. Rows
  are pruned unconditionally after 48h every sweep run, regardless of sweep-loop outcome.
- See `process/general-plans/completed/otp-delivery-observability_20-07-26/` for the full plan;
  Cast DLR response-shape stability past the one observed `REJECTD` shape remains unproven (blocked
  on Cast activating a real sender ID for live traffic).

### Resend email
- `resend` dependency in `packages/core`
- `apps/admin/src/lib/server/emails/`
- Stub fallback: when `RESEND_API_KEY` is blank, the email provider factory falls back to a stub
  (no real send) — matches the `@veent/core` factory+stub pattern used for network/payments
  providers.

## Environment and Configuration

**Config files:** `packages/db/drizzle.config.ts` (single migration authority), per-app
`vite.config.ts` (inline SvelteKit config — no `svelte.config.js`), per-app `.env.example`
(real `.env` is git-ignored), `compose.yaml` (local Postgres bootstrap via `db:start`).

**Env var groups (names only, never values):**

`apps/customer/.env.example` (28 vars):
- Core: `DATABASE_URL`, `ORIGIN`, `TUNNEL_ORIGIN`
- Auth: `BETTER_AUTH_SECRET`
- Network: `NETWORK_CONTROLLER`, `MIKROTIK_HOST`/`USER`/`PASSWORD`/`PORT`/`TLS`/`TLS_INSECURE`/`HOTSPOT_USER`/`HOTSPOT_PASSWORD`
- Cron: `CRON_SECRET`, `CRON_IP_ALLOWLIST`
- Payments: `MAYA_PUBLIC_KEY`, `MAYA_SECRET_KEY`, `MAYA_SANDBOX`
- SMS: `SMS_PROVIDER`, `ITEXMO_API_CODE`/`EMAIL`/`PASSWORD`/`SENDER_ID`, `UNISMS_SECRET_KEY`/`SENDER_ID`, `SMSGATE_BASE_URL`/`USERNAME`/`PASSWORD`

`apps/admin/.env.example` (31 vars):
- Core: `DATABASE_URL`, `ORIGIN`
- Auth: `BETTER_AUTH_SECRET`
- Network: `NETWORK_CONTROLLER`, `MIKROTIK_*` (same trio as customer, plus more), `HEALTH_EXCLUDE_INTERFACES`
- WireGuard isolation: `ADMIN_WG_HOSTS`, `ADMIN_WG_IPS`
- Cron: `CRON_SECRET`
- Email: `RESEND_API_KEY`, `EMAIL_FROM`
- Owner bootstrap: `OWNER_EMAIL`/`PASSWORD`/`NAME`
- Sentry: `PUBLIC_SENTRY_DSN`, `PUBLIC_SENTRY_ENVIRONMENT`, `SENTRY_ENVIRONMENT`,
  `PUBLIC_SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_TRACES_SAMPLE_RATE`, `PUBLIC_SENTRY_RELEASE`,
  `SENTRY_RELEASE`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG_SLUG`, `SENTRY_PROJECT_ID`

`apps/locator/.env.example` (2 vars): `DATABASE_URL`, `ORIGIN`

**Validation:** `apps/{customer,admin}/src/lib/server/validateEnv.ts` runs once at boot from
`hooks.server.ts` — hard-fails prod on missing required vars, warns only in dev.
`NETWORK_CONTROLLER=mikrotik` conditionally requires the `MIKROTIK_*` trio. Admin enforces
`BETTER_AUTH_SECRET` ≥ 32 chars.

## Feature Folders

Approved feature folders under `process/features/`:

- **incident-management** (`process/features/incident-management/`) — staff-facing incident/issue
  tracking + Sentry ingestion, assignment, self-report, notifications, resolution. Merged
  (PR #74, `ccb2e02`, 62 files / ~4.2k lines); post-merge 13-finding audit (2H/5M/6L) fully
  remediated 2026-07-10 (`completed/ims-audit-remediation_10-07-26/`) — see that feature's
  `_GUIDE.md` for full detail. Same session shipped post-audit polish: notification clicks open a
  `NotificationModal.svelte` preview instead of navigating, incident-card status indicators moved
  to the card footer, notification list loads at the `(app)` layout level. Key locations:
  `apps/admin/src/routes/(app)/issues/**`, `(app)/sentry/**`,
  `apps/admin/src/lib/server/{issues.ts,issueNotify.ts,notifications.ts,sentry/*}`,
  `lib/server/emails/issue-assigned.ts`,
  `packages/db/src/schema/{admin-issue.ts,admin-issue-event.ts}`.
  Follow-up session (20-07-26) closed 3 of those items: sentryIssueId provenance verification
  (M4d, `completed/sentry-issueid-provenance_20-07-26/`) — `?/track` now round-trips the Sentry API
  before persisting a "Tracked from Sentry" incident, fail-closed on lookup failure; also fixed a
  standalone hygiene finding where `apps/admin/e2e` was leaking live Sentry credentials (see
  `process/context/tests/all-tests.md`). Sentry permalink host pinning
  (`completed/sentry-permalink-host-pinning_20-07-26/`) — `httpsUrl()` now pins the permalink host
  to `sentry.io`/regional subdomains. Repo-wide lint prettier-config drift — partially closed (the
  crashing bad path is fixed; 297 files of pre-existing style drift remain, tracked in
  `backlog/repo-wide-lint-prettier-drift_NOTE_10-07-26.md`). IMS e2e spec modernization closed
  20-07-26 (`completed/ims-e2e-spec-modernization_20-07-26/`) — all 12 admin e2e specs (23 tests)
  green; see `process/context/tests/all-tests.md`. **Currently open backlog:** manager-board
  pagination and repo-wide lint drift (partial). (M2 secret rotation and the Maya/TEST_ENV coverage
  question are both resolved and archived/superseded — see `completed/ims-audit-remediation_10-07-26/`
  and `process/general-plans/backlog/customer-locator-e2e-harness-integration-gaps_NOTE_20-07-26.md`.)
- **admin-staff-governance** (`process/features/admin-staff-governance/`) — staff accounts, roles,
  2FA/step-up auth, invite/promote/owner-change/wipe workflows. Mature, no imminent task; created
  now because governance work is a high-risk class (auth/identity, trust-boundary) and will need
  risk-evidence-pack treatment. Key locations: `apps/admin/src/routes/(app)/staff`,
  `routes/{activate,enroll-2fa,login,login/2fa,forgot-password,reset-password,logout}`,
  `lib/server/{auth.ts,auth-guard.ts,twoFactor.ts,step-up.ts,owner-change.ts,wipe-verification.ts,
  postLogin.ts,adminBypass.ts,adminAccess.spec.ts}`,
  `packages/core/src/services/{staff.ts,adminAccess.ts}`,
  `packages/db/src/schema/{admin.ts,admin-two-factor.ts,admin-owner-change.ts,auth-admin.ts}`.

Deferred candidates (stay in `process/general-plans/` until they accumulate 5+ artifacts):
`network-infrastructure-ops` (admin MikroTik/networks/map — has an uncommitted
`docs/mikrotik/login.html` change), `captive-portal-flow` (customer), `maya-payments` (customer),
`locator-app`.

## Team and Workflow

- Small team: 2+ humans plus AI agents doing substantial implementation.
- Branching: feature branches + PRs into `staging` — **`staging` is the current frontier**; there
  is no production deploy process yet.
- **No CI**: `.github/` is absent. Quality gates are manual: `check` → `lint` → `test` → admin e2e.
- Commits use conventional-commit prefixes (`feat`, `fix`, `docs`, etc.).
- **Agents never commit** — the user commits himself; agents prepare staged changes + a suggested
  message only.
- Browser-visible changes need BOTH an agent browser pass AND a human verification handoff before
  being considered done.

## Gotchas — Agents Must Be Careful About

- **Migration-chain drift:** the dev DB is push-managed; `db:migrate` fails on journal drift.
  Apply new migration DDL directly to verify locally, but still generate the migration file for
  the record.
- **MAC-trust residual:** the customer portal's `?mac=` query param is inherently
  client-influenceable (a captive-portal constraint) — never describe it as server-authoritative.
  Only M-2 is fully closed; M-1/L-1 are MITIGATED, not eliminated.
- **MikroTik/captive-portal quirks:** RouterOS templating, walled-garden constraints, OS
  captive-probe endpoints (`generate_204`, `gen_204`, `ncsi.txt`, `connecttest.txt`,
  `hotspot-detect.html`), and CNA (Captive Network Assistant) mini-browser behavior are all easy
  to break with well-intentioned cleanups — verify guest onboarding end-to-end after touching this
  surface.
- **Maya payment paths need extra care:** money math, grant atomicity, and webhook flows are
  high-risk — treat with the same rigor as auth/billing surfaces generally.
- **Auth isolation:** the two `betterAuth()` instances (customer `veent-portal` cookie prefix,
  admin `radius-admin` cookie prefix) must NEVER be cross-wired or unified — each has its own
  `BETTER_AUTH_SECRET` and schema builder output.

## Scan Metadata

- Generated: 2026-07-10T09:20:47+08:00
- HEAD: 0d3c7928fe5454e74068b1f61f7fc7adc89db520
- Mode: fresh
- Package manager: bun
