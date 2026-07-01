# Admin Improvement Audit + Whole-System Sentry Plan

## Context

An in-depth, "everything that can be improved" analysis of the **admin** app, plus a guide for
**how Sentry can be implemented** across the system. This is an **analysis-only** document — no
code changes. Two separated outputs below.

Scope notes:
- **Output 1 (admin audit)** stays inside `apps/admin/` + its `packages/core` / `packages/db`
  dependencies, per the project rule.
- **Output 2 (Sentry)** is whole-system (admin + customer + locator), written admin-first since
  the wiring is identical per app.

Findings were validated against the live tree. Key verifications: `owner-change.ts:258` N+1,
dialogs using the `<dialog open>` attribute instead of `.showModal()`, **no `svelte.config.js`**
in either app (SvelteKit config lives in `vite.config.ts`), and the `hooks.server.ts` /
`validateEnv.ts` shapes. Stack: Vite 8, SvelteKit 2.63, Svelte 5.56, `adapter-node`, better-auth,
Drizzle/Postgres, run via `node build` or `bun ./build`.

A standing strength worth stating up front: the codebase is in good shape. SSE lifecycle,
rate-limiting, mandatory 2FA, step-up governance, env fail-fast, and security headers are all
done well. The items below are refinements, not rescues.

---

# OUTPUT 1 — Admin Improvement Audit

## Priority summary

| # | Sev | Area | Issue | Fix location |
|---|-----|------|-------|--------------|
| 1 | High | Testing | Zero E2E + zero form-action tests on governance flows (promote/demote/wipe/invite) | new `*.e2e.ts`, action unit tests |
| 2 | High | Resilience | DB/grant/email calls unwrapped → raw 500s, swallowed failures | map/users/networks/staff `+page.server.ts` |
| 3 | High | A11y | 4 dialogs are non-modal (`<dialog open>`, not `.showModal()`) → no focus trap, no Esc, no `aria-modal` | `PromoteDialog`, `OwnerChangeDialog`, `WipeDialog`, `AddStaffForm` |
| 4 | Med | DRY | `requireOwner()` reimplemented in 6 server files | extract to `$lib/server/auth.ts` |
| 5 | Med | DRY | Email send + numeric-field validation duplicated 4×/3× | `$lib/server/email.ts`, `$lib/server/formValidation.ts` |
| 6 | Med | Perf | N+1 approval query in `listOpenRequests()` | `owner-change.ts:258` |
| 7 | Med | UX | Missing loading skeletons (Users, Staff, Finance/transactions) | those `+page.svelte` |
| 8 | Med | DRY | ~250 lines of near-identical dialog + table-toolbar boilerplate | `BaseDialog.svelte`, `TableToolbar.svelte` |
| 9 | Low | Observability | All-`console.*` logging, no centralized capture (feeds Output 2) | new `$lib/server/logger.ts` |
| 10 | Low | Auth | Session not server-invalidated on demote (role re-check covers it) | `owner-change.ts` |
| 11 | Low | Schema | No index on `adminOwnerChangeRequest.initiatedBy` | `schema/admin-owner-change.ts` |
| 12 | Low | Perf | `listTransactions`/session-log queries fetch wide then slice in memory | `queries.ts` |

---

## 1. Testing (Highest leverage gap)

**What exists (good):** pure-logic unit tests — `owner-change-rules.test.ts`, `confirm.test.ts`,
`reach.test.ts`, `clustering.test.ts`, `csv.test.ts`, `rateLimit.test.ts`, `twoFactor.test.ts`,
`router-models.test.ts`. Vitest is split into `client` (browser) + `server` (node) projects in
`vite.config.ts:27-53`.

**What's missing:**
- **No E2E at all.** `playwright.config.ts` exists and `test:e2e` is wired, but there are **zero
  `*.e2e.ts` files**. The riskiest flows in the app — login→2FA, promote (name + TOTP step-up),
  demote/remove (unanimous owner approval), user wipe, network wipe, staff invite→activation —
  have no behavioral coverage.
- **No form-action tests.** None of the `+page.server.ts` `actions` (users block/kick/delete,
  staff invite/promote/remove/owner-change, finance export, content CRUD) are tested. These are
  exactly the owner-gated governance mutations where a regression is most damaging.
- **No SSE resilience test** for `live.svelte.ts` ref-counting / reconnect, and **no component
  tests** for the sortable/filterable tables.

**Recommended roadmap (checkpoint-gated):**
1. *Governance E2E first* — `login → 2FA → promote → demote` and `wipe (request code → confirm)`.
   Highest risk, highest regression cost.
2. *Action unit tests* — invoke each `actions.*` with a mocked `db`/`auth`, assert the
   `requireOwner` gate, the rate-limit call, and the success/`fail()` shape.
3. *Component + SSE* — table sort/filter/select-all; `connectLive()` open/close ref-count.

This is item #1 because every other change below is safer to make once these exist.

## 2. Error handling & resilience

The pattern is inconsistent: some paths wrap DB/integration calls and return a clean `fail()`,
others call straight through and let a throw become a raw 500.

- **High — Map actions unwrapped.** `map/+page.server.ts` `addPlace`/`updatePlace`/`deletePlace`
  call `createNetworkPlace()` / `updateNetworkPlace()` / `deleteNetworkPlace()` with no try/catch.
  A DB hiccup = generic 500, no actionable message. Wrap and `return fail(500, { error })`.
- **Med — Sign-in grant swallowed.** `postLogin.ts:~40-45` logs a failed device internet grant and
  proceeds. Staff signs in but gets no internet, with no signal. Surface a non-blocking warning to
  the layout (`locals.grantWarning`) so the UI can toast it.
- **Med — Email error handling inconsistent.** Some sends `fail(502)`, others `console.warn` and
  continue (`auth.ts:56`, `staff:89`, `users:140`, `networks:110`). Pick a rule: **critical**
  (wipe code) → fail; **notification** (owner-change/invite) → warn + continue. Encode it once in
  the shared helper (item #5).
- **Low — SSE initial snapshot swallowed.** `api/connected/+server.ts` suppresses an error on the
  first `dashboardSnapshot()`; client shows nothing until the next notify. Log + optionally emit an
  error frame.

## 3. Accessibility

**Strong baseline:** `min-h-[44px]` enforced on buttons/nav, broad `aria-label` coverage on
icon buttons, `aria-sort` on sortable headers, `.sr-only` headers, `RevenueChart` SVG has
`role="img"` + labeled focusable points. `MobileDrawer.svelte` already implements a correct
focus trap + restore + Esc — it's the reference pattern.

**The real gap — dialogs are non-modal.** `PromoteDialog`, `OwnerChangeDialog`, `WipeDialog`,
`AddStaffForm` render `<dialog>` driven by the **`open` attribute** (see comment
`PromoteDialog.svelte:26`). With the attribute (vs `dialog.showModal()`) there is **no focus
trap, no Esc-to-close, no inert backdrop, and no implicit `aria-modal`** — a keyboard user can
tab into the page behind a "modal" promote/wipe confirm. Fix: open via `.showModal()` and restore
focus to the trigger on close (reuse the `MobileDrawer` pattern), or add explicit
`aria-modal="true"` + focus management. This pairs naturally with the `BaseDialog` extraction (#8).

Smaller: dialog close doesn't return focus to the invoking control.

## 4–5. Duplication & dead code

- **`requireOwner()` ×6.** Re-implemented in staff/users/networks and content/{packages,limits,faq}
  server files. Extract one `requireOwner(userId)` into `$lib/server/auth.ts` returning
  `fail(403)` or null. Centralizes the policy; one place to change if roles get more granular.
- **Email send ×4.** `try { mailer.send } catch { console.warn }` repeated in auth/staff/users/
  networks. Extract `sendEmail(to, msg, context): Promise<boolean>` into `$lib/server/email.ts`,
  with the critical-vs-notification rule from #2 baked in.
- **Numeric validation ×3.** `packages` `num()`, `limits` `intIn()`, `faq` inline parsing — same
  idea, three shapes. Extract `parseIntField(form, key, {min,max})` to `$lib/server/formValidation.ts`.
- **No true dead code found.** `allowWifi` is `dev`-gated, `/api/router-log` requires 2FA, `/docs`
  is intentional. Good. (Seed/simulate/clear scripts are `bun run`-only, not routes — fine.)

## 6. Query layer

- **N+1 in `listOpenRequests()`** (`owner-change.ts:258`): one approvals query **per pending
  request** inside the `for` loop. Low blast radius (pending owner-changes are rare and few), but
  trivially fixed: batch with `inArray(approval.requestId, rows.map(r => r.id))` then group in a
  `Map`. Worth doing for correctness-of-pattern.
- **Wide-then-slice reads** (`queries.ts`, network session logs `.limit(400)` then cap 15/AP in
  memory; transactions similar). Works and is bounded, but order by the grouping key and tighten
  the limit, or paginate, if AP/transaction counts grow.
- **Missing index** on `adminOwnerChangeRequest.initiatedBy` — add if any future query filters on
  it (none today, hence Low).
- **Already good:** `listUsers()` is a single grouped join (no N+1); the finance period
  `sql.raw('IYYY-IW')` is safe because `granularity` is enum-validated first.

## 7. Loading / empty / error states

`EmptyState` is used consistently and the **Networks** page has a proper skeleton mirroring its
layout — use it as the template. Missing skeletons on **Users**, **Staff**, and
**Finance/transactions** (they pop in, or fully reload on period change with no pending state).
Bind a pending state to the period form and show the skeleton while the new range loads.

## 8. Component architecture

Solid shared `ui/` + `feature/` libraries and a reused `sortable.svelte.ts`. Two consolidations:
- **`BaseDialog.svelte`** — `PromoteDialog`/`OwnerChangeDialog`/`WipeDialog` share ~250 lines of
  open-effect/reset/enhance boilerplate. Extract a base taking title/body/action snippets — and
  fix the modal a11y (#3) **once**, in the base.
- **`TableToolbar.svelte`** — Users/Staff/Transactions repeat ~50 lines each of search + mobile
  sort `<select>` + filters.

## 9–11. Lower-priority

- **Logging** is 100% `console.*` with manual `[scope]` prefixes — fine for dev, invisible in prod.
  A thin `logger(scope)` wrapper is the bridge to Output 2.
- **Session on demote** isn't server-invalidated; the per-request role re-check in `hooks.server.ts`
  neutralizes it, so this is defense-in-depth, not a hole.
- **Svelte 5 runes: A+.** `$props`/`$derived`/`$state`/`$effect` used correctly throughout;
  `onMount` only for Leaflet/external polling. No legacy patterns to fix.

---

# OUTPUT 2 — Sentry Implementation Guide (whole system)

Goal: error capture + light performance tracing, with **strict PII scrubbing** (this system holds
phone numbers, emails, MAC addresses, and payment data). Applies to `apps/admin`, `apps/customer`,
and `apps/locator`; wiring is identical per app, shown admin-first.

## Stack gotchas to resolve first (read before installing)

1. **No `svelte.config.js`.** Both apps put the SvelteKit config *inside* `vite.config.ts`
   (`sveltekit({ ... })`). The Sentry SvelteKit wizard (`npx @sentry/wizard`) assumes a
   `svelte.config.js` and may not patch correctly — **wire manually** (steps below) rather than
   trusting the wizard.
2. **Vite 8 is bleeding-edge.** `@sentry/sveltekit` pulls in `@sentry/vite-plugin` for source-map
   upload. Pin to the **latest** `@sentry/sveltekit` (v10+) and verify it accepts Vite 8 / Rollup 4
   before committing the source-map step; if the plugin lags, ship error-capture first and add
   source-map upload once compatible.
3. **Bun runtime caveat.** If you run `bun ./build`, Sentry **error capture works**, but
   **performance/auto-instrumentation (OpenTelemetry) is partial under Bun**. For full tracing,
   run the server under **`node build`** with an `--import` instrumentation file (below). Decide
   per-deploy; error capture alone needs neither.

## Env vars (follow the existing `validateEnv` convention)

Per app, add to `.env.example` and the deploy env:
- `PUBLIC_SENTRY_DSN` — client + server DSN (`$env/static/public`; `PUBLIC_` so it reaches the browser).
- `SENTRY_ENVIRONMENT` — `production` / `staging` (optional; default from `dev`).
- `SENTRY_RELEASE` — git SHA or `package.json` version (optional).
- `SENTRY_AUTH_TOKEN` — **build-time only**, for source-map upload (never shipped to client).

Extend each `validateEnv.ts` in the established loud-in-prod / quiet-in-dev style:
```
if (!dev && !env.PUBLIC_SENTRY_DSN) {
  console.warn('[env] PUBLIC_SENTRY_DSN unset — error tracking disabled');
}
```
Keep it a **warning, not a hard requirement**, so a missing DSN degrades to "no telemetry," never
to a boot failure.

## Wiring points (per app)

**A. `src/hooks.server.ts`** — currently a single `handle = handleBetterAuth` with no `sequence`,
no `handleError`. Change to:
- `Sentry.init({ dsn, environment, release, tracesSampleRate, beforeSend, beforeSendTransaction })`
  at the top (after `validateEnv()`).
- `export const handle = sequence(Sentry.sentryHandle(), handleBetterAuth)`.
- `export const handleError = Sentry.handleErrorWithSentry(existingHandleErrorOrUndefined)`.
- Inside `handleBetterAuth`, **after** the active-staff check, attach context:
  `Sentry.setUser({ id: session.user.id })` and `Sentry.setTag('staff_role', role)` — **id and role
  only, never email/name** (see scrubbing). Tag `app: 'admin'`.

**B. `src/hooks.client.ts`** — **does not exist in any app; create it:**
- `Sentry.init({ dsn: PUBLIC_SENTRY_DSN, ... , beforeSend })` (same scrubbing).
- `export const handleError = Sentry.handleErrorWithSentry()`.

**C. Build config (`vite.config.ts`, since there's no `svelte.config.js`)** — wrap the exported
config with the Sentry plugin for source maps + release:
- add `build: { sourcemap: true }`,
- apply `sentrySvelteKit({ sourceMapsUploadOptions: { org, project, authToken: env.SENTRY_AUTH_TOKEN } })`
  in `plugins` (gated so it no-ops without a token, keeping local dev clean).
- Per-app `project`: `admin`, `customer`, `locator`.

**D. Full tracing under Node (optional)** — create `src/instrument.server.ts` calling
`Sentry.init(...)` and start the built server with `node --import ./build/instrument.server.js build`,
so OpenTelemetry auto-instruments Postgres/HTTP. Skip if you only want error capture or run on Bun.

**E. `+error.svelte`** — both apps already render status/message; **no change needed** (the
`handleError` hook captures before the page renders). Optionally surface `event.errorId` for support.

## Strict PII scrubbing (required — do not skip)

Centralize a `beforeSend` (and `beforeSendTransaction`) redactor, shared via a small
`packages/core` helper so all three apps use one implementation. It must:
- **Drop** outright: OTP codes, TOTP secrets, session IDs, `BETTER_AUTH_SECRET`, `MAYA_SECRET_KEY`,
  `RESEND_API_KEY`, passwords.
- **Mask** in messages, breadcrumbs, request data, and stack frames: phone numbers
  (`+63•••4567`), emails (`u•••@host`), MAC addresses (`AA:BB:CC:•••`), `buyer_name`/`buyer_email`
  from gateway payloads.
- **Set `sendDefaultPii: false`** and strip request bodies/cookies/headers (`authorization`,
  `cookie`) in the integration config.
- **Identify users by id only** (already enforced at the `setUser` call site).

Because `setUser` uses the staff/customer **id** and tags use **role**, the high-signal context is
preserved without shipping PII. The redactor is the safety net for anything that leaks into a
message or breadcrumb.

## High-value context to add (optional, after baseline works)

Breadcrumbs/tags at the moments worth tracing — all id/status only, no PII:
- **Admin:** login success/2FA, owner-change request/approve/execute (actor id, target id, action),
  network grant/revoke result, email send success/failure.
- **Customer:** payment webhook (txId, status — **not** buyer), access grant (free/paid, result),
  device bind/unbind.

## Suggested rollout order

1. **admin**, error-capture only (init + hooks server/client + env warn + scrubbing). Verify a
   thrown test error reaches Sentry **with PII masked**.
2. Add **source-map upload** once Vite-8 plugin compatibility is confirmed.
3. Add **light tracing** (`tracesSampleRate` ~0.1) — Node `--import` path if not on Bun.
4. Replicate to **customer**, then **locator** (same files, change `project`/`app` tag).
5. (Optional) land the `logger(scope)` wrapper from Output 1 #9 so `console.*` sites also
   `captureException`, giving one capture path.

---

## Verification

This is an **analysis-only** document — nothing to run. To validate the findings:
- **Audit claims:** open the cited `file:line` (e.g. `owner-change.ts:258`, `PromoteDialog.svelte:26`,
  the `requireOwner` copies); confirm there's no `svelte.config.js`
  (`find apps -name 'svelte.config.*'` returns nothing).
- **When any item is later implemented:** the regression gate is Output 1 #1 — stand up the
  governance E2E + action tests *first*, then make changes against that safety net. For Sentry,
  the acceptance check is "a deliberately thrown error appears in Sentry with phone/email/MAC
  **masked** and no secrets present."
