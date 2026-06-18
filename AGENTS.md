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

### Core Business Rules

1. Internet access granted only after credits deducted AND session logged → router `grant_url` redirect
2. Grace Period: 3-minute temporary access when balance = 0 and free-time in cooldown (rate-limited to 3/hr)
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
