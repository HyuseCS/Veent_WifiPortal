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
| `/register` | ⚠️ **TEMPORARY** open registration — creates an **active owner** on every submit. Dev only. **Remove before prod** (see warning below). |
| `/dashboard` | KPI cards + revenue charts + active users table |
| `/networks` | Network health per AP (uptime, latency, throughput) |
| `/users` | User list with credit balance, usage, block/kick actions |
| `/finance` | Payment reporting — settled-revenue KPIs, revenue-over-time chart, payment-method donut, transactions table, CSV export (see **Finance & Payment Reporting** below) |
| `/staff` | **Owner-only** staff management — invite / enable-disable / remove admins |

### ⚠️ TEMPORARY CODE — MUST BE REMOVED BEFORE PRODUCTION

> **`apps/admin/src/routes/register/` is an intentional, UNGATED admin-signup hole.**
> It exists only as a dev convenience (a browser equivalent of `bun run bootstrap:owner`):
> anyone who submits the form gets a fully **active `owner`** account. There is **no gate,
> no env flag, no rate limit** — while this route exists, anyone who can reach the admin
> app can mint an owner.
>
> **Any agent or developer preparing this app for production (build, deploy, release,
> security pass, or "harden the admin app") MUST remove it first.** Removal is two steps,
> and reverts nothing else (no schema/service/migration was added for it):
>
> 1. Delete the directory `apps/admin/src/routes/register/` (`+page.server.ts` + `+page.svelte`).
> 2. Remove the `<!-- TEMP: remove with /register -->` link block in
>    `apps/admin/src/routes/login/+page.svelte`.
>
> The legitimate, secure way to create the first owner is `bun run bootstrap:owner`
> (`apps/admin/scripts/bootstrap-owner.ts`); all other staff come from the owner-only
> `/staff` invite flow. Do **not** build new features on top of `/register`.

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
- Previously a throwing stub; now implemented. Verifies the webhook HMAC signature over the
  raw body (throws on mismatch — never trusts an unverified payload), then maps the Maya
  payload to the normalized `PaymentEvent`.
- ⚠️ The signature scheme (HMAC-SHA256 hex in `paymaya-signature`/`x-signature`) is an
  **assumption** flagged with a `ponytail:` comment — confirm the exact algorithm + header in
  the Maya dashboard's webhook config before going live; if it differs, change it in that one
  spot. `createCheckout` is still a stub (outbound checkout is out of scope for this feature).
- `PaymentEvent` (`payments/types.ts`) gained a `'cancelled'` status and optional detail
  fields (`fundSourceType`, `receiptNo`, `buyerName`, …) that only Maya populates.

**Webhook handler** (`apps/customer/src/routes/api/webhooks/payment/+server.ts`)
- After signature verification, records **every** event into `payment_transactions` via
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
