# Plan: Rebrand admin app "Veent" → "RADIUS by Parafiber"

## Context

The admin dashboard (`apps/admin/`) currently brands itself as **"Veent Admin"**. But:
- **Veent** is the company (the operator/builder).
- **RADIUS** is the product name.
- **Parafiber** is the client that commissioned the product.

The product UI should present as **RADIUS** with a muted **"by Parafiber"** attribution, not as
"Veent". This is an **admin-app-only** rebrand: every user-facing "Veent" string, the brand
glyph, internal storage/auth identifiers, and config placeholders move to RADIUS. The shared
`@veent/*` monorepo packages are explicitly **out of scope** and untouched.

User decisions:
- **Scope:** everything, including the better-auth `cookiePrefix` (accepts: existing admin
  login sessions are invalidated → everyone re-logs in; dev-only impact).
- **Wordmark:** `RADIUS` (bold) + `Admin` (muted), with a small muted **"by Parafiber"** line.
- **Email identity:** **RADIUS** (sender name + body copy).

## Hard exclusions (DO NOT TOUCH)

- **`@veent/*` package imports** (`@veent/core`, `@veent/db`) — shared packages defined in
  `packages/`, consumed via workspace symlinks. Renaming breaks the build and is outside the
  admin scope. Affected lines in `package.json` deps, `vite.config.ts` `ssr.noExternal`, and
  ~10 source files stay exactly as-is. Comments that merely *mention* `@veent/db`/`@veent/core`
  (db.ts:5, queries.ts:4, vite.config.ts:23) also stay — they correctly name the real packages.
- **`MIKROTIK_USER="veent-portal"`** (`.env`) — this is a **live router credential**, not
  branding. It must match the account configured on the MikroTik router; renaming it unilaterally
  breaks network grant/revoke (core business rule #1). **Leave as-is**; flag for the operator to
  rename only in coordination with a router-side change.
- Anything in `apps/customer/` or `packages/` — different scope.

## Changes

### 1. User-facing brand text → "RADIUS" wordmark

Wordmark pattern (replaces `Veent <span muted>Admin</span>`):
`RADIUS <span muted>Admin</span>` plus a small muted `by Parafiber` attribution line where
vertical space allows (sidebar + auth page headers). Keep existing classes/structure; this is a
text swap, not a layout redesign.

- `src/lib/components/layout/Sidebar.svelte`
  - L26: brand glyph `V` → `R`.
  - L29: `Veent <span class="text-sidebar-muted">Admin</span>` → `RADIUS <span class="text-sidebar-muted">Admin</span>`.
  - Add a muted `by Parafiber` line under the wordmark (e.g. `<span class="text-xs text-sidebar-muted">by Parafiber</span>`), within the existing logo block.
- `src/routes/login/+page.svelte` L19, `src/routes/register/+page.svelte` L17,
  `src/routes/activate/+page.svelte` L18: `Veent <span ...>Admin</span>` → `RADIUS <span ...>Admin</span>`,
  with a muted `by Parafiber` subtitle beneath each heading (match each page's existing heading markup).
- `src/routes/docs/+server.ts` L18 (`title: 'Veent WiFi Portal API'`) and L229
  (`<title>Veent WiFi Portal — API Reference</title>`) → `RADIUS WiFi Portal ...`.

### 2. Emails → RADIUS identity

- `src/lib/server/emails/activation.ts`
  - L31 subject: `Activate your Veent Admin account` → `Activate your RADIUS Admin account`.
  - L42 HTML heading: `Veent <span ...>Admin</span>` → `RADIUS <span ...>Admin</span>`.
  - L47 / L78 body copy: `Veent Admin dashboard` → `RADIUS Admin dashboard` (both HTML + plaintext).
- `src/lib/server/email.ts` L12 default `from`: `'Veent <onboarding@resend.dev>'` →
  `'RADIUS <onboarding@resend.dev>'`.

### 3. Internal identifiers (storage / auth / package name)

Cookie + storage keys must change in lockstep with their readers, or theme/layout/auth break:

- **Theme key** (`veent-admin-theme` → `radius-admin-theme`): `src/app.html` L12 (pre-paint read)
  AND `src/lib/components/layout/ModeToggle.svelte` L17 (write) — change **both** together.
- **Dashboard layout cookie**: `src/lib/dashboard-layout.ts` L9
  `DASH_LAYOUT_COOKIE = 'veent-dash-layout'` → `'radius-dash-layout'`. Single source of truth
  (read SSR-side in `(app)/+layout.server.ts`, written in `(app)/+layout.svelte` via the constant)
  — value-only change; stale old cookie is simply ignored → harmless reset to default `bento`.
- **Auth cookie prefix** (`veent-admin` → `radius-admin`): `src/lib/server/auth.ts` L56 AND
  `scripts/bootstrap-owner.ts` L48 — change **both** to keep bootstrap and runtime consistent.
  (Invalidates current sessions — expected per user decision.)
- **App package name**: `package.json` L2 `"name": "veent-admin"` → `"radius-admin"`.
  (Leave the `@veent/*` **dependencies** below it untouched.)

### 4. Config placeholders & comments

- `.env.example` (committed template): L4 example URL `admin.veent.io`, L26 format comment
  `"Veent <noreply@yourdomain>"`, L27 `EMAIL_FROM="Veent <noreply@veent.io>"` → RADIUS equivalents
  (e.g. `RADIUS <noreply@yourdomain>`). These are placeholders; the real verified sending domain
  is infra/DNS-dependent and noted, not assumed.
- `.env` (local file): L12 `EMAIL_FROM="Veent <noreply@veent.io>"` → `RADIUS <...>`; L4 comment.
  **Do not touch L17 `MIKROTIK_USER`** (see exclusions).
- Comments: `src/routes/layout.css` L4 (`Veent admin design tokens`) → `RADIUS admin design tokens`;
  `scripts/bootstrap-owner.ts` L4 example `OWNER_EMAIL=you@veent.io` → neutral RADIUS example.
  (Comments mentioning `@veent/db`/`@veent/core` stay — they name the real packages.)

## Critical files (summary)

Brand text: `Sidebar.svelte`, `login/+page.svelte`, `register/+page.svelte`, `activate/+page.svelte`,
`docs/+server.ts`. Email: `emails/activation.ts`, `email.ts`. Identifiers: `app.html`,
`ModeToggle.svelte`, `dashboard-layout.ts`, `auth.ts`, `bootstrap-owner.ts`, `package.json`.
Config: `.env.example`, `.env`, `layout.css`.

## Verification

1. `rg -i "veent" apps/admin --glob '!node_modules'` → the **only** remaining hits should be the
   intentional `@veent/*` package imports/config and the `MIKROTIK_USER` credential. No brand text,
   no `veent-admin`/`veent-dash` keys, no `veent-admin` cookie prefix.
2. `cd apps/admin && bun run check` → 0 errors / 0 warnings (catches any broken constant reference).
3. `bun run build` → passes (confirms `@veent/*` imports still resolve; nothing structural broke).
4. `bun run dev`, then eyeball: sidebar shows `R` glyph + "RADIUS Admin" + muted "by Parafiber";
   `/login`, `/register`, `/activate` headers read "RADIUS Admin / by Parafiber"; `/docs` title is
   "RADIUS WiFi Portal".
5. Theme toggle still persists (key renamed on both read+write); dashboard layout switcher still
   persists (cookie value renamed); logging in works (new cookie prefix — confirms re-login path).
6. Trigger the staff invite flow (or inspect the stub mailer console output) → email subject/from/body
   all say "RADIUS".
7. Run Svelte MCP `svelte-autofixer` on any edited `.svelte` files until clean (project rule).
