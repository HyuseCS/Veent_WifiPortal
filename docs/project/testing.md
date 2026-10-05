# Testing

## Runners

Apps (`admin`, `customer`, `locator`) and `packages/core` use Vitest 4. `apps/admin` also has a Playwright e2e suite. `packages/db` has no tests.

Each app's Vitest config has two projects:

- **server** (`environment: 'node'`): `src/**/*.{test,spec}.{js,ts}`, excludes `.svelte.{test,spec}`. All current unit tests run here.
- **client** (real headless Chromium via `@vitest/browser-playwright` and `vitest-browser-svelte`): `src/**/*.svelte.{test,spec}.{js,ts}`, excludes `src/lib/server/**`. It needs Playwright Chromium installed. There are zero `.svelte.test.ts` files today, so this project runs nothing.

All apps set `expect: { requireAssertions: true }`. A test with no assertion fails.

Which to use:

| Need                                                                  | Use                                           |
| --------------------------------------------------------------------- | --------------------------------------------- |
| Server logic, route handlers, `lib/server/*`, validation, rate limits | Vitest server project (default)               |
| Component behavior in a real browser                                  | Vitest client project (no example exists yet) |
| Real navigation, auth/2FA redirects, admin governance flows           | Playwright e2e (admin only)                   |
| Shared services in `packages/core`                                    | `packages/core` Vitest                        |

Order to run: narrowest unit test, then wider unit and integration tests, then e2e only if the UI is the thing under test.

## Commands

Root:

| Command          | What it does                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `bun run test`   | `bun run --filter './apps/*' --filter '@veent/core' test`. Does not include `packages/db`. |
| `bun run check`  | `svelte-check` per app. Does not include `packages/core` or `packages/db`.                 |
| `bun run lint`   | `prettier --check . && eslint .`                                                           |
| `bun run format` | `prettier --write .`                                                                       |

Per app: `bun run test` (`vitest run --passWithNoTests`), `bun run test:unit` (watch), `bun run test:e2e` (`playwright test`), `bun run check`. `packages/core`: `bun run test` (`vitest run`).

Gate order: `check`, `lint`, `test`, then admin `test:e2e` last. It is slow (Chromium, throwaway DB, build).

Two traps when you run a single file:

- Never run `bun test <file>`. Bun's own runner has no `vi.setSystemTime`, so fake-timer specs fail. Use `bunx vitest run <file>`.
- Run `bunx vitest run <path>` from inside the app directory (`cd apps/admin && bunx vitest run 'src/routes/(app)/sentry/track-provenance.test.ts'`). There is no root vitest config. Each app's `$lib` alias comes from its own `vite.config.ts`.

Admin harness scripts (`apps/admin/`): `bun run test:seed` (seed `radius_admin_test`), `test:simulate`, `test:simulate:fresh`, `test:clear`.

Customer load test (`apps/customer/loadtest/`): `bun run loadtest:seed`, `bun run loadtest:cleanup`, `k6 run loadtest/grant-spike.js` (manual).

## Unit tests and the database

Unit tests need no database. They mock everything, including `$env/dynamic/private`, with `vi.mock`.

Exception: in-process PGlite specs. They need no external DB and are safe to run anywhere:

- `packages/core/src/services/outage.integration.spec.ts`
- `packages/core/src/services/networkHealth.integration.spec.ts`

PGlite applies the real migration chain (`migrate()` over `packages/db/drizzle/`). It enforces real unique and check constraints. A `network_health_name_key` violation raises a real `23505` through drizzle (`DrizzleQueryError` with `.cause` of `{ code: '23505', constraint: '...' }`). So constraint-retry logic can be tested for real. See the unique-violation pattern in `architecture.md`.

## Admin e2e harness

Read this before you change `apps/admin/e2e/`.

- **Throwaway DB.** `apps/admin/e2e/global-setup.ts` seeds `TEST_DATABASE_URL` (default `postgres://root:root@localhost:5432/radius_admin_test`, override with `E2E_DATABASE_URL`). It runs `scripts/seed-test-data.ts`, which does `DROP SCHEMA`. Never point it at the dev DB.
- **No `.env.test`.** Isolation is an inline `TEST_ENV` object in `apps/admin/e2e/config.ts`. It goes to the seed process and to Playwright `webServer.env`. Bun auto-loads `apps/admin/.env`, so `TEST_ENV` must override:
  - `DATABASE_URL` to the throwaway DB.
  - `NETWORK_CONTROLLER='stub'` so no real router is used.
  - `RESEND_API_KEY=''` and `EMAIL_FROM=''` to force the console mailer.
  - `SENTRY_AUTH_TOKEN=''`, `SENTRY_ORG_SLUG=''`, `SENTRY_PROJECT_ID=''`. Before this fix the e2e server used real Sentry credentials from `.env` and called the production Sentry org.
  - Maya needs no override. Admin has no Maya code path.
- **2FA is in the flow.** `global-setup.ts` logs in with real Chromium, enrolls mandatory 2FA at `/enroll-2fa`, then saves `storageState` to `e2e/.auth/owner.json` and the TOTP secret to `e2e/.auth/owner-totp.txt`. `e2e/totp.ts` makes codes with no external library.
- **Build and preview.** `webServer` runs `npm run build && npm run preview` on port 4173 with `reuseExistingServer: false`. Server timeout 180 s. Test timeout 60 s.
- **Serial only.** `workers: 1`, `fullyParallel: false`. Specs change shared state. Each spec seeds itself through `config.ts` helpers.
- **Storage state leaks.** `playwright.config.ts` merges `storageState: OWNER_STORAGE_STATE` into every context, including `browser.newContext()` and `newPage()` inside a test. For an unauthenticated or non-owner session, pass `storageState: { cookies: [], origins: [] }` to `newContext({...})`, or use `test.use({...})`. Otherwise the "fresh" context keeps the owner session. This once looked like a slow login (a 60 s timeout).
- **Specs (12 files, 23 tests):** `content-mfa`, `finance-export`, `incident-detail`, `incident-notifications`, `incident-self-report`, `incident-sentry`, `incident-timeline`, `invite`, `networks`, `owner-change`, `promote`, `wipe`.

## Quality gates

- **CI:** `.github/workflows/ci.yml` runs on PRs to `staging` and `main`: check, prettier, eslint, test, build, then admin e2e. Prettier is non-blocking because of format drift. `publish.yml` builds after merge.
- **Pre-push hook:** `.githooks/pre-push` runs `bun run test`. It works only after `git config core.hooksPath .githooks`.
- **Lint:** one root `eslint.config.js` (flat: `@eslint/js`, `typescript-eslint`, `eslint-plugin-svelte`, `eslint-config-prettier`).
- **Format:** `.prettierrc`: tabs, single quotes, no trailing commas, `printWidth: 100`, `svelte` and `tailwindcss` plugins, `tailwindStylesheet: apps/admin/src/routes/layout.css` (repo-root relative). It only sets Tailwind class sort order. Customer and locator files sort against admin's theme. That is cosmetic.

## Known gaps

- `packages/db` has no tests.
- `apps/locator` has one unit test (`lib/clusters.test.ts`) and no e2e specs.
- `apps/customer` and `apps/locator` have Playwright configs but no specs.
- The client Vitest project is wired in all apps but has no specs. A clean run proves nothing.
- No coverage tooling (no `@vitest/coverage-*`).
- `prettier --check .` reports about 297 files with old format drift. So `bun run lint` fails at the repo root and `eslint .` never runs from it (CI runs `eslint` separately). Background: `process/features/incident-management/backlog/repo-wide-lint-prettier-drift_NOTE_10-07-26.md`.
- **Customer e2e has no safe harness.** `apps/customer/playwright.config.ts` has a credential tripwire in `webServer.env`. It is not uniformly fail-closed:
  - SMS (`CAST_*`, `ITEXMO_*`, `UNISMS_*`, `SMSGATE_*`) is blanked. `sendOtp` throws before any network call (`dev` is false in a preview build). Fail-closed.
  - Maya is only fail-rejected. `basicAuth('')` still builds a header, the request leaves the machine, and it returns `401`. `MAYA_SANDBOX` is pinned `'true'` (it cannot be blank, `payments.ts` throws on anything but `'true'`/`'false'`), so a stray request goes to sandbox.
  - MikroTik uses `NETWORK_CONTROLLER: 'stub'`. No call is made.
  - `DATABASE_URL` and Sentry vars are not covered. A customer e2e spec would hit the dev DB and send events to real Sentry.
  - `apps/locator` has no external credentials to leak.
  - Needed before any customer e2e spec: a payments stub, an SMS stub reachable in preview, a throwaway-DB harness like admin's, and Sentry DSN blanking.
- `TEST_ENV` and the customer tripwire have no rule that forces new external integrations into them. Each entry was added after a gap was found. A lint or test rule that cross-checks integration modules against harness overrides is not built.
