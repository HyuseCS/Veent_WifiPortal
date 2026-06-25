## Project: Veent WiFi Portal

A WiFi captive portal + operator admin dashboard. Guests connect to WiFi, authenticate, manage credits, and buy internet time. Operators manage users, networks, and revenue.

### Stack

- **Language**: TypeScript
- **Package Manager**: bun (workspaces monorepo)
- **Framework**: SvelteKit 5 (Svelte runes — `$state`, `$derived`, `$props`)
- **Styling**: TailwindCSS v4
- **Database**: PostgreSQL via Drizzle ORM
- **Auth**: better-auth (customers) + TOTP (admin)
- **Payments**: PayMongo / Xendit (webhooks)
- **Testing**: Vitest · Playwright
- **Tooling**: prettier · eslint · sveltekit-adapter

### Monorepo Structure

```
apps/
  customer/   # Captive portal (WiFi guests) — mobile-first, ultra-lightweight
  admin/      # Operator dashboard — desktop-first, data-dense
packages/
  db/         # Shared Drizzle schema + migrations
```

### Customer Portal — Key Pages

| Route | Purpose |
|-------|---------|
| `/` | Landing: explains Free Time vs Paid Tiers |
| `/auth/login` `/auth/register` | better-auth forms |
| `/dashboard` | Credits balance, free-time eligibility, tier selection |
| `/top-up` | Credit bundle storefront |
| `/top-up/processing` | Waiting room — polls DB after payment, SSE push to dashboard |
| `/api/auth/[...all]` | better-auth catch-all |
| `/api/network/grant` | Triggers router `grant_url` to drop firewall |
| `/api/network/revoke` | Cron-callable endpoint to revoke MAC access |
| `/api/webhooks/payment` | PayMongo/Xendit webhook — verifies signature, credits balance |

### Admin Dashboard — Key Pages

| Route | Purpose |
|-------|---------|
| `/login` | TOTP-secured login |
| `/dashboard` | KPI cards + revenue charts + active users table |
| `/networks` | Network health per AP (uptime, latency, throughput) |
| `/users` | User list with credit balance, usage, block/kick actions |
| `/finance` | Payment reporting — settled-revenue KPIs, revenue-over-time chart, payment-method donut, transactions table, CSV export (see **Finance & Payment Reporting** below) |
| `/staff` | **Owner-only** staff management — invite / enable-disable / remove admins |

### Owner bootstrap (the `/register` hole was removed)

There used to be an ungated `apps/admin/src/routes/register/` route that minted an
**active `owner`** on every submit (a dev convenience). It was **deleted** during the
backend-hardening pass (see `docs/SECURITY_RISKS.md` R6) along with its `/login` link.
Do **not** reintroduce a browser owner-signup route.

The only ways to create staff now:
- **First owner:** `bun run --filter radius-admin bootstrap:owner`
  (`apps/admin/scripts/bootstrap-owner.ts`, uses `OWNER_*` env).
- **All other staff:** the owner-only `/staff` invite flow.

### Admin TOTP / MFA (mandatory)

The "TOTP (admin)" in the stack is real: staff sign-in requires a second factor, via
better-auth's **two-factor plugin** (no new dependency), wired server-side through
`auth.api.*` (admin has no `createAuthClient`).
- **Enrollment is mandatory.** `(app)/+layout.server.ts` redirects any active staff with
  `twoFactorEnabled === false` to `/enroll-2fa` (password → QR + one-time backup codes →
  confirm a code). The bootstrap owner hits this gate on first login — no special-casing.
- **Two-step login.** `signInEmail` returns `{ twoFactorRedirect: true }` for enrolled
  users (no session yet); `/login/2fa` verifies a 6-digit TOTP **or** a backup code, and
  only *then* runs the active-status check + device internet grant (shared
  `$lib/server/postLogin.ts` — never grant on an unverified half-login).
- Secret + backup codes are stored **encrypted at rest** (`BETTER_AUTH_SECRET`) in
  `admin_two_factor` (admin-only; migration `0020`). The QR is rendered server-side to an
  SVG string (`uqr`) — no client QR component. Self-serve disable is out of scope.

### Backend hardening (Phases 0–3 — complete)

A senior-review-driven hardening pass landed; the rationale is in
`docs/ARCHITECTURE_REVIEW.md` and the risk ledger in `docs/SECURITY_RISKS.md`, with a
phase roadmap at the bottom of `apps/admin/To_Improve.md`. What changed (all additive):

- **Grant atomicity** — `startPaidSession` (`packages/core`) spends credits + opens the
  session + fires the router grant in **one transaction**; a failed grant rolls back the
  spend (no "paid, got nothing"). Wired into `/api/network/grant` + dashboard buy-tier.
- **Rate limiting** — shared `rateLimit(scope, identifier, max, windowMs)` helper
  (`apps/{customer,admin}/src/lib/server/rateLimit.ts`) over the existing `rate_limits`
  table (now with additive `scope`/`identifier` columns, migration `0014`). Covers admin
  login, grant, finance CSV export, payment webhook (per-IP flood cap), SSE stream count,
  and admin email sends (`checkAdminEmailLimit`). **OTP/SMS limiting is teammate-owned —
  do not touch `otpRateLimit.ts` or the mac/phone limiter paths.**
- **Cron allowlist** — optional `CRON_IP_ALLOWLIST` env (customer) gates `/api/network/revoke`
  + `/api/payments/reconcile` by source IP (in addition to `x-cron-secret`).
- **Config fail-fast** — `validateEnv()` per app, called in `hooks.server.ts`: hard-fails in
  prod on missing required vars, warns in dev, no-ops during build.
- **Maya webhook** — `verifyWebhook` re-fetches the authoritative payment from Maya with the
  secret key (no HMAC); the unsigned body is never trusted.
- **Pool bound** — `createDb` sets an explicit Drizzle pool `max` (10); the LISTEN client
  stays isolated at `max:1`.

### Finance & Payment Reporting

The `/finance` admin page and its backing pieces capture and report on **every** payment-gateway
webhook event — not just the successful, credited ones. This section documents what each new
piece is and why it exists.

**Why it exists:** before this, the only persisted trace of a payment was
`credit_ledger.external_transaction_id`, written **only** on a successful top-up. Failed,
expired, and cancelled attempts — plus all the gateway detail (fund source, receipt, buyer,
error code) — were discarded. Operators had no way to see the full payment funnel, success
rate, or why payments failed. The Finance feature adds a complete, queryable record.

**`payment_transactions` table** (`packages/db/src/schema/customer.ts`)
- The full record of every Maya webhook hit. PK is the gateway's own transaction id, so a
  resent or status-transitioning webhook **upserts** the same row (see webhook handler).
- Superset of `credit_ledger`: it holds `PAYMENT_SUCCESS` **and** `PAYMENT_FAILED` /
  `PAYMENT_EXPIRED` / `PAYMENT_CANCELLED`, with `fund_source_type`/`fund_source_masked`,
  `receipt_no`, `buyer_name`/`buyer_email`, and `error_code`/`error_message`.
- `user_id` / `package_id` are **nullable** — a failed event may carry no `referenceId`, so
  it's still recorded, just unattributed. Migration: `packages/db/drizzle/0008_*.sql`.

**`maya.ts` `verifyWebhook`** (`packages/core/src/integrations/payments/maya.ts`)
- Previously a throwing stub; now implemented. **No HMAC.** Maya Checkout webhooks are
  unsigned, so it takes only the payment id from the (untrusted) body and **re-fetches the
  authoritative payment from Maya's API with the secret key**, trusting THAT response — never
  the posted body. Throws on lookup failure or status mismatch, then maps the re-fetched
  payment to the normalized `PaymentEvent`. A spoofed webhook can't produce a real paid
  payment under our account. Covered by `apps/customer/src/lib/server/maya-webhook.spec.ts`.
  `createCheckout` is still a stub (outbound checkout is out of scope for this feature).
- `PaymentEvent` (`payments/types.ts`) gained a `'cancelled'` status and optional detail
  fields (`fundSourceType`, `receiptNo`, `buyerName`, …) that only Maya populates.

**Webhook handler** (`apps/customer/src/routes/api/webhooks/payment/+server.ts`)
- A per-IP flood cap (120/min) runs first — every call triggers an outbound re-fetch to Maya,
  so this blunts request-amplification. Then `verifyWebhook` re-fetches and authenticates.
- After verification, records **every** event into `payment_transactions` via
  `onConflictDoUpdate` (NOT `DoNothing`) — Maya can resend or send a later status transition
  for the same tx id, and we must keep the latest state, not freeze the first.
- Crediting is unchanged and still happens **only** for `paid` events; `addCredits` remains
  idempotent on `external_transaction_id`, so recording-then-crediting never double-credits.

**Admin queries** (`apps/admin/src/lib/server/queries.ts`): `financeKpis`, `revenueByPeriod`,
`paymentMethodBreakdown`, `listTransactions` — all read `payment_transactions`, all accept a
`{ from, to }` range. Period→range parsing is shared in `$lib/server/period.ts` (used by both
the page `load` and the CSV endpoint).

**Revenue source-of-truth (important):** Finance "Gross Revenue (settled)" = actual amount the
gateway charged on `PAYMENT_SUCCESS`. This is intentionally a **different** number from the
Dashboard's revenue, which estimates from `credit_ledger ⨝ packages.fiatCost` (package list
price). They can legitimately diverge; the Finance KPI is labelled "(settled)" to make the
distinction explicit. Do not "reconcile" them by accident.

**CSV export** is a **GET endpoint** (`finance/export/+server.ts`), linked with a plain
`<a download>` — a SvelteKit form `action` cannot return a downloadable `Response`. The donut
is a no-dependency SVG (`$lib/components/feature/DonutChart.svelte`, same `stroke-dasharray`
technique as `RevenueChart`).

### Core Business Rules

1. Internet access granted only after credits deducted AND session logged → router `grant_url` redirect
2. Payment Walled Garden: payment gateway domains (PayMongo, Xendit, bank/e-wallet redirect hosts) are permanently whitelisted in the router so checkout is always reachable without granting internet access (no payment grace period)
3. Credits added ONLY after payment webhook verified (never on checkout creation)
4. Free Time: 15 min per 12-hour cooldown window
5. Use Server-Sent Events (SSE) for real-time connected-user updates — never poll DB every second

### Design System

See `docs/DESIGN_GUIDELINES.md` for the full design system. See `PRODUCT.md` for brand strategy, users, and principles.

**Architecture:** All colors use CSS custom properties (`--color-brand`, `--color-cta`, `--color-ink`, etc.) defined in `@theme {}` inside each app's `layout.css`. A `data-theme` attribute on `<html>` switches presets — components never hardcode colors.

**Quick reference:**
- Customer: `Plus Jakarta Sans` font · pure white bg · coral `oklch(0.62 0.18 28)` CTA · `max-w-sm` single-column
- Admin: `system-ui` font + `font-mono` for data fields · dark `oklch(0.10 0.02 195)` sidebar
- Default brand: deep teal `oklch(0.38 0.13 185)` primary — switchable via theme presets (jade, cobalt, mono)
- Icons: Lucide Svelte only — no emojis as icons
- All interactive elements: `min-h-[44px]`
- Status colors: `--color-online` (jade green) · `--color-warning` (amber) · `--color-blocked` (coral-red)
- Theme selector lives in admin sidebar; persists to DB and injects `data-theme` on `<html>`

### SvelteKit 5 Conventions (CRITICAL)

- Use `$state()` for reactive state — not `let`
- Use `$derived()` for computed values — not `$:`
- Use `$props()` for component props — not `export let`
- Use `+page.server.ts` for DB access and sensitive data — never `+page.ts`
- Use form actions (`+page.server.ts` `actions`) for form submissions — not `fetch('/api/...')`
- Use `+page.ts` `load()` for data loading — not `onMount`
- Use `import { page } from '$app/stores'` — not `window.location`
- Use `transition:fade` directive — not manual CSS class toggling

### Database / Migrations (CRITICAL — keep `db:migrate` portable)

The committed migrations in `packages/db/drizzle` are the **only** way the schema changes,
on every machine. Drift breaks `db:migrate` for teammates.

- **Never hand-edit the DB** to change schema — no `psql ALTER`/`CREATE TABLE`, and don't
  `db:push` against a migrated DB. To change schema: edit `packages/db/src/schema/*.ts`,
  run `bun run db:generate`, then `bun run db:migrate`, and **commit the generated SQL**.
- If you must apply SQL by hand for a one-off (debugging), also generate + commit the
  matching migration, and make it **idempotent** (`ADD COLUMN IF NOT EXISTS`,
  `CREATE TABLE/INDEX IF NOT EXISTS`) so it no-ops over the already-applied change.
- Drizzle applies pending migrations in timestamp order and **stops on the first error**,
  so one un-guarded `ALTER` that hits "already exists" blocks every later migration.
- Verify a change is shareable by migrating a throwaway DB (see README → Migration workflow).

---

## Svelte MCP Tools

You have access to the Svelte MCP server with comprehensive Svelte 5 and SvelteKit documentation.

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.
