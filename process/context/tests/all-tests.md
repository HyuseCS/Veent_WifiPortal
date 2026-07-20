---
name: context:all-tests
description: "Test runners, exact commands, the admin e2e throwaway-DB harness quirks, and known coverage gaps — the tests group entrypoint/router"
keywords: test, tests, vitest, playwright, e2e, unit test, svelte-check, lint, coverage, test:seed, radius_admin_test, TEST_ENV, browser test, requireAssertions
related: []
date: 20-07-26
---

# veent-wifiportal - All Tests

Last updated: 2026-07-20

Attach this file first when the task involves testing, verification, or test debugging.

This is the fast operator guide for the testing surface:

- which runner to use
- what command to start with
- how to quickly debug common failures
- which deeper file to read next

Do not load the whole `process/context/tests/` folder by default. Start here, then drill down.

---

## How This File Works

This is the `all-tests.md` entrypoint for the `tests/` context group. It follows the `all-*.md` routing convention:

1. Agents read `all-context.md` first and get routed here for testing tasks
2. This file gives quick decision rules and commands
3. For deeper details, agents follow the routing table below to specific docs

As the project grows, add deeper docs to this group (e.g., `e2e-tests.md`, `debugging-and-pitfalls.md`) and add routing entries below. This file stays the fast-start entrypoint.

---

## What This Covers

- test runner selection
- quick commands by package
- fast debugging procedures
- current testing gaps worth remembering

## Read This When

Use this file when you need to:

- run tests after implementation
- decide between test runners
- debug failing tests

## Quick Routing

(No deeper test docs yet. Add routing entries here as they are created — e.g. an `e2e-tests.md` for the admin Playwright harness, or a `debugging-and-pitfalls.md` once quirks outgrow the section below.)

## Quick Decision Guide

Every app (`apps/admin`, `apps/customer`, `apps/locator`) and `packages/core` uses **Vitest 4**. `apps/admin` additionally has a **Playwright** e2e suite. `packages/db` has no tests at all.

Each app's Vitest config splits into two projects:

- **server project** (`environment: 'node'`) — `src/**/*.{test,spec}.{js,ts}`, excludes `.svelte.{test,spec}`. This is where **all current unit tests actually live**.
- **client project** (real headless Chromium via `@vitest/browser-playwright` + `vitest-browser-svelte`) — `src/**/*.svelte.{test,spec}.{js,ts}`, excludes `src/lib/server/**`. Wired in all 3 apps but **zero `.svelte.test.ts` files exist anywhere yet** — this project currently runs nothing.

All apps set `expect: { requireAssertions: true }` — an assertion-less test is a **failing** test, not a silent pass.

### Use Vitest (server project) when
- testing server-side logic: route handlers, `lib/server/*`, validation, rate limiting, DB-adjacent logic (mocked)
- this is the default for nearly all new unit tests today — every existing unit test file in the repo runs here

### Use Vitest (client project) when
- testing `.svelte` component behavior in a real browser context
- note: this is a green field — no existing `.svelte.test.ts` file to pattern-match from yet; needs Playwright's Chromium installed locally

### Use Playwright e2e when
- the behavior depends on real navigation, auth/2FA redirects, or full-stack admin governance flows
- only `apps/admin` has actual specs today; `apps/customer` and `apps/locator` have Playwright configs wired but zero specs

### Use `packages/core` Vitest when
- testing shared services (`observability`, `outage`) — includes one integration spec that talks to a real in-process PGlite instance (no external DB needed)

## Default Verification Order

Unless the task clearly needs a different path:

1. run the narrowest existing automated test
2. use unit/integration tests before browser tests
3. use end-to-end tests only when the real UI is the thing being verified

Recommended gate order for this repo (no CI to enforce it, so run manually in this sequence): **`bun run check` → `bun run lint` → `bun test` → admin `test:e2e` last** (slow — real Chromium + throwaway DB + build; only run when touching admin governance/incident surfaces).

## Commands

**Root (`package.json`):**

| Command | What it does |
|---|---|
| `bun test` | `bun run --filter './apps/*' --filter '@veent/core' test` — CI-style one-shot across all 3 apps + core. **`packages/db` is excluded (no test script).** |
| `bun run check` | `bun run --filter './apps/*' check` — svelte-check per app. **`packages/core` and `packages/db` are NOT in this fan-out** (they have tsconfigs but no `check` script). |
| `bun run lint` | `prettier --check . && eslint .` |
| `bun run format` | `prettier --write .` |

**Per app** (`apps/admin`, `apps/customer`, `apps/locator` — identical scripts):

| Command | What it does |
|---|---|
| `vitest run --passWithNoTests` (via `bun run test`) | one-shot unit run |
| `vitest` (via `bun run test:unit`) | watch mode |
| `playwright test` (via `bun run test:e2e`) | e2e run |
| `svelte-kit sync && svelte-check --tsconfig ./tsconfig.json` (via `bun run check`) | typecheck |

**`packages/core`:**

| Command | What it does |
|---|---|
| `vitest run` (via `bun run test`) | one-shot unit run |

**`packages/db`:** no test script — zero tests, not covered by any root fan-out.

**Gotcha — scoping to a single file:** never invoke `bun test <file>` directly (bun's
native test runner) to scope a unit run — it silently no-ops `vi.setSystemTime` (undefined),
failing any spec using fake timers. Use `bunx vitest run <file>` (or `cd apps/admin && bunx
vitest run src/lib/server/foo.test.ts`) instead — this runs the real vitest project the repo
is built on. `bun test` (no args, root `package.json` alias) is fine — it fans out to `bun
run --filter ... test`, which is `vitest run` per app; the trap is only `bun test <file>`
called directly.

**Gotcha — cwd matters for `bunx vitest run <file>`.** There is no root `vitest.config.*` —
each app's `$lib` alias comes only from that app's `vite.config.ts` (`sveltekit()` plugin
options). Run `bunx vitest run <path>` from **inside the target app's directory**
(`cd apps/admin && bunx vitest run 'src/routes/(app)/sentry/track-provenance.test.ts'`), not from
the repo root — running from root risks vitest picking up the wrong (or no) project config and
failing `$lib` alias resolution. Confirmed during the M4d Sentry-provenance EVL run (20-07-26).

**Admin harness scripts** (`apps/admin/scripts/`):

| Command | What it does |
|---|---|
| `bun run test:seed` | seeds the throwaway `radius_admin_test` DB (`scripts/seed-test-data.ts`) |
| `bun run test:simulate` | simulate against seeded data |
| `bun run test:simulate:fresh` | fresh simulate run |
| `bun run test:clear` | clear throwaway test data |

**Customer loadtest scripts** (`apps/customer/loadtest/`):

| Command | What it does |
|---|---|
| `bun run loadtest:seed` | seed data for load testing |
| `bun run loadtest:cleanup` | cleanup after load testing |
| `k6 run loadtest/grant-spike.js` | manual k6 invocation (not wrapped in a package script) |

## Debugging Quick Reference

**Admin e2e harness mechanics (the crown jewels — read before touching `apps/admin/e2e/`):**

- **Throwaway DB, never dev DB.** `globalSetup` (`apps/admin/e2e/global-setup.ts`) seeds `TEST_DATABASE_URL` (defaults to `postgres://root:root@localhost:5432/radius_admin_test`, override via `E2E_DATABASE_URL`) by running `scripts/seed-test-data.ts` with `TEST_ENV`. The seed does a **`DROP SCHEMA`** — this must **never** point at the real dev DB.
- **No `.env.test` file exists anywhere.** Isolation is entirely an inline `TEST_ENV` object in `apps/admin/e2e/config.ts`, injected into both the seed subprocess and Playwright's `webServer.env`. Bun auto-loads `apps/admin/.env` otherwise, so `TEST_ENV` must explicitly override:
  - `DATABASE_URL` → the throwaway DB
  - `NETWORK_CONTROLLER='stub'` → never touches a real MikroTik router
  - `RESEND_API_KEY=''` + `EMAIL_FROM=''` → blanks Resend to force the console-stub mailer
  - `SENTRY_AUTH_TOKEN=''` + `SENTRY_ORG_SLUG=''` + `SENTRY_PROJECT_ID=''` (added 20-07-26, M4d) →
    blanks Sentry; before this fix the e2e webserver silently inherited real credentials from
    `apps/admin/.env` and made live, authenticated calls to the production Sentry org — see Known
    Gaps below for the general lesson this exposed
  - **Maya payments — investigated and closed 20-07-26.** `apps/admin` has no Maya code path
    at all (verified by exhaustive grep — only inert comments/string-label hits); admin never
    calls Maya, so there was nothing for `TEST_ENV` to cover. The real exposure this
    investigation found was in `apps/customer`/`apps/locator` instead — see Known Gaps below.
- **2FA is mandatory in the flow.** `global-setup.ts` does a real Chromium login, walks through mandatory 2FA enrollment (`/enroll-2fa`), then caches `storageState` at `e2e/.auth/owner.json` plus the TOTP secret at `e2e/.auth/owner-totp.txt` for reuse across specs. TOTP itself is generated via a small stdlib helper (`e2e/totp.ts`), no external TOTP library.
- **`webServer` builds + previews, doesn't reuse.** Playwright's `webServer` runs `npm run build && npm run preview` on port `4173` with `reuseExistingServer: false` (deliberate — always a clean build/preview). `webServer.timeout` is 180s, test `timeout` is 60s.
- **Serial execution only.** `workers: 1`, `fullyParallel: false` — governance specs mutate shared state; each spec self-seeds via `config.ts` helpers rather than relying on isolation between workers.
- **10 admin e2e specs today:** `content-mfa`, `finance-export`, `incident-detail`, `incident-notifications`, `incident-sentry`, `incident-timeline`, `invite`, `owner-change`, `promote`, `wipe`.

**Unit test DB dependence:**

- Unit tests need **no DB at all** — everything (including `$env/dynamic/private`) is mocked via `vi.mock`.
- The exception: two specs use an **in-process PGlite** instance (real-Postgres semantics, still
  zero external dependencies, safe to run blind, no setup required) —
  `packages/core/src/services/outage.integration.spec.ts` and
  `packages/core/src/services/networkHealth.integration.spec.ts`. PGlite applies the real
  migration chain (`migrate()` over `packages/db/drizzle/`), so it genuinely enforces committed
  unique/check constraints — a name-key `network_health_name_key` unique violation was empirically
  confirmed (20-07-26) to raise a real, catchable `23505` through drizzle exactly like production
  Postgres (`DrizzleQueryError` → `.cause` with `{ code: '23505', constraint: '...' }`), so
  constraint-violation retry/discriminator logic can be genuinely PGlite-tested rather than assumed
  or faked. See the shared discriminator pattern in `all-context.md` §Key Patterns and Conventions.

**Client (browser) Vitest project:**

- Requires Playwright's Chromium to be installed locally (`playwright install chromium` or similar) — the client project won't run without it.
- Currently has **zero specs** in all 3 apps, so a clean `vitest run` on the client project is a true no-op today, not a signal of health.

**Quality gates:**

- **Lint:** single root `eslint.config.js` flat config (`@eslint/js` + `typescript-eslint` + `eslint-plugin-svelte` + `eslint-config-prettier`). No per-package configs.
- **Format:** `.prettierrc` — tabs, single quotes, no trailing commas, `printWidth: 100`, `svelte` + `tailwindcss` plugins, `tailwindStylesheet: apps/admin/src/routes/layout.css` (repo-root-relative; fixed 20-07-26 — previously `./src/routes/layout.css`, which was root-relative to a path that doesn't exist and crashed prettier with ENOENT at the repo root). Note: this path only feeds Tailwind class **sort order**, not correctness — customer/locator files sort against admin's theme, which is cosmetic, not a bug.

## Known Gaps

- `packages/db` has **zero tests** and no test script — not covered by any root command.
- `apps/locator` has exactly **1 unit test** (`lib/clusters.test.ts`) and **no e2e specs**.
- `apps/customer` and `apps/locator` have Playwright e2e configs wired but **no specs** — only `apps/admin` has actual e2e coverage. As of 20-07-26, `apps/customer/playwright.config.ts` carries a credential tripwire in `webServer.env`, but its protection is **not uniform — do not call it "fail-closed" across the board**: SMS (`CAST_*`/`ITEXMO_*`/`UNISMS_*`/`SMSGATE_*`, all four blanked) is genuinely fail-closed — `sendOtp` throws before any network call because `dev` is `false` in a preview build. Maya is only **fail-rejected**: `basicAuth('')` still builds a valid (empty-credential) auth header, so the checkout request is actually sent and comes back `401` — the payload leaves the machine, it is not prevented. `MAYA_SANDBOX` is pinned `'true'` (it cannot be blanked — `payments.ts` hard-throws on anything but `'true'`/`'false'`) so an escaping request lands on sandbox rather than production, but that is a weaker guarantee than "never leaves the machine." MikroTik (`NETWORK_CONTROLLER: 'stub'`) is a real stub — no call attempted. Neither `DATABASE_URL` nor Sentry vars are touched by the tripwire — a future customer e2e spec still runs against the real dev DB and ships events to real Sentry. `apps/locator`'s config was left unchanged — its env schema has no external credentials to leak. Full detail: `process/general-plans/backlog/customer-locator-e2e-harness-integration-gaps_NOTE_20-07-26.md`.
- The **client (browser) Vitest project** is wired in all 3 apps (`@vitest/browser-playwright` + `vitest-browser-svelte`, real headless Chromium) but has **zero `.svelte.test.ts` files** anywhere — no component-level test currently exists.
- **No coverage tooling** configured anywhere (no `@vitest/coverage-*` dep, no coverage config).
- **No CI** — `.github/workflows` is absent; the recommended gate order (`check` → `lint` → `test` → admin `test:e2e`) is manual only.
- **No confirmed pre-commit hooks** — a `.githooks/` directory exists at the repo root, but it is not confirmed wired via `core.hooksPath`; verify before relying on it to catch anything automatically.
- **Root `bun run lint` still fails repo-wide, but the cause changed 20-07-26.** The original crash
  (bad `tailwindStylesheet` path, ENOENT) is fixed — see Quality Gates above. Root `bun run lint`
  now fails because `prettier --check .` reports 297 files with genuine pre-existing style/format
  drift (not a crash), so `&& eslint .` never runs and eslint remains unverified at the repo root.
  Backlog: `process/features/incident-management/backlog/repo-wide-lint-prettier-drift_NOTE_10-07-26.md`
  (updated 20-07-26 with the narrowed remaining scope).
- **`TEST_ENV` (and the customer tripwire) have no enforcement that new external integrations get
  added to them.** `TEST_ENV` currently covers DB, router, mailer, and (as of 20-07-26) Sentry —
  each added reactively after being found missing, not proactively. Admin's Maya coverage question
  was investigated 20-07-26 and closed (admin has no Maya code path); the same investigation found
  a real gap in `apps/customer`/`apps/locator` instead (see above) and shipped a tripwire for it.
  The structural fix — a lint/test rule cross-referencing integration modules against
  harness-env overrides, so this class of gap can't recur silently — is still unimplemented.
  Backlog: `process/general-plans/backlog/customer-locator-e2e-harness-integration-gaps_NOTE_20-07-26.md`.
- **3/10 admin E2E specs have known-flaky residuals** as of 2026-07-10 (`incident-detail`, `incident-notifications`, `incident-timeline`): stale `role="menuitem"` queries after an intentional a11y change (dropdown → labelled list) plus a notification-click flow that now opens a modal instead of navigating; a `loginNonManager` 2FA-enroll helper that times out near the 60s test cap; and a "2 unread" count assertion that needs a live trace (app logic verified correct by inspection in all 3 cases — no app regression). Backlog: `process/features/incident-management/backlog/ims-e2e-spec-modernization_NOTE_10-07-26.md`.
