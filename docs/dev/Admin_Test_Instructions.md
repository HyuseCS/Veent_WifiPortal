# Admin Module — Testing Guide

How to populate the database with realistic data and debug the `apps/admin` dashboard end-to-end.

---

## TL;DR

```bash
# 1. Make sure Postgres is up and apps/admin/.env has DATABASE_URL + BETTER_AUTH_SECRET
# 2. Seed a fresh dataset (from repo root):
bun run --filter radius-admin test:seed

# 3. Start the admin app:
bun run dev:admin            # http://localhost:5174

# 4. Log in: owner@veent.test  /  password123

# 5. (Optional) Stream live activity in a 2nd terminal to test the live dashboard:
bun run --filter radius-admin test:simulate
```

**Prefer building from scratch?** Skip steps 2 & 5 and just run `bun run --filter radius-admin
test:simulate:fresh` — it wipes the DB and populates it live from zero (it bootstraps the catalog and
the `owner@veent.test` login itself).

### Scripts at a glance

| Command | What it does | Use for |
|---------|--------------|---------|
| `test:seed` | Clean rebuild + fixed deterministic dataset (20 customers, 150 payments, …) | **Static** testing — a known snapshot |
| `test:simulate` | Streams random live activity into the DB (self-bootstraps if empty) | **Dynamic** testing — live SSE dashboard |
| `test:simulate:fresh` | Wipes data, then streams live activity from zero | Watch the dashboard fill **from empty** |
| `test:clear` | Truncates all data, keeps the schema | Leave the DB **empty** when done |

All are run as `bun run --filter radius-admin <command>` from the repo root.

---

## What the seed script does

**File:** `apps/admin/scripts/seed-test-data.ts` · **Command:** `bun run --filter radius-admin test:seed`

It builds a realistic, **deterministic** snapshot of a WiFi operator mid-operation so every admin page has data to render and every action has something to act on.

### Steps it runs

1. **Clean rebuild (destructive).** Drops the `public` + `drizzle` schemas and re-applies **all** migrations from scratch. This guarantees a known-good schema every run — and also fixes a database that's behind on migrations. **All existing data is wiped.**
2. **Catalog.** Seeds the 7 packages (Free Time, 3 credit bundles, 3 access tiers) and 6 access points (`network_health`). `admin_role` (`owner`/`admin`) is seeded automatically by a migration.
3. **Staff** — via better-auth, so the passwords are real and login actually works.
4. **Customers** — 20 customer accounts with varied balances and states (direct DB inserts).
5. **Activity** — 150 payment transactions over 90 days, matching credit-ledger entries, and network sessions (active / expired / free-time).
6. **Self-check** — asserts every customer's stored balance equals the sum of their ledger rows; the script fails loudly if not.

### Key properties

- **Deterministic.** A seeded PRNG (no `faker` dependency) produces the same dataset every run, so bugs reproduce.
- **Re-runnable.** Each run is a clean rebuild — run it again any time to reset to a pristine state.
- **Never touches the router.** All rows are inserted straight to the DB via Drizzle. The script deliberately does **not** call `startSession` / `addCredits` / `network.grant`, because `.env` may point `NETWORK_CONTROLLER` at a real MikroTik — a seed must never fire real firewall grants.

### What gets created

| Area | Data |
|------|------|
| **Staff** | 1 owner (active) + 5 admins: 3 active, 1 pending, 1 disabled |
| **Customers** | 20 total — 3 blocked, 4 low-balance (< ₱10), 13 normal; ~8 currently online |
| **Access points** | 6 — healthy, degraded (high latency), offline, and one unmapped (no coordinates) |
| **Payments** | 150 over 90 days — mix of success / failed / expired / cancelled, all 5 fund sources, ~1/3 in the last 7 days, some unattributed (no linked user) |
| **Sessions** | Active (online users), expired history, and free-time grants |

---

## Live simulation (dynamic dashboard testing)

**File:** `apps/admin/scripts/simulate-live.ts` · **Command:** `bun run --filter radius-admin test:simulate`

Run the simulator to generate **continuous random activity** so you can test the **live SSE
dashboard**. It runs forever (Ctrl+C to stop) and, at random intervals, performs random actions:

| Action | What it writes | Where it shows up live |
|--------|----------------|------------------------|
| 👤 **Signup** | New `customer_user` (zero balance, no history) | `/users` list grows |
| 🟢 **Arrive** | New active session (spends credits for a tier, or free 15 min) | `/dashboard` active sessions + per-AP user counts |
| 🔴 **Depart** | Expires a current active session | `/dashboard` active list shrinks |
| 💰 **Top-up** | `PAYMENT_SUCCESS` + credit ledger + balance increment | `/dashboard` revenue KPI · `/finance` · `/users` balance |
| ⚠️ **Failed payment** | `PAYMENT_FAILED/EXPIRED/CANCELLED` (no credit) | `/finance` only |
| 📶 **Health flap** | Updates an AP's latency/throughput; occasionally toggles it offline | `/dashboard` + `/networks` AP cards |

**It is self-bootstrapping — you do _not_ need to seed first.** On startup it ensures the catalog
(packages + APs) and an owner login exist, creating them if missing. Customers are **not** pre-created:
the simulator signs them up over time, so on a clean database you watch the user base, revenue, and
sessions grow **from zero**. (It also runs fine _after_ `test:seed` — the bootstrap is idempotent and
it just adds activity on top of the existing dataset.)

**Why it updates live:** Postgres triggers (migration `0006`) fire `pg_notify('dashboard')` on every
write to `network_sessions` / `credit_ledger` / `network_health`. The admin app holds a `LISTEN`
connection and re-pushes a dashboard snapshot over SSE — so the simulator just writes to the DB and
the dashboard reacts on its own. No polling.

### How to use it

```bash
# Terminal 1 — admin app
bun run dev:admin

# Terminal 2 — start the activity stream (default 0.8–4s between actions)
bun run --filter radius-admin test:simulate

# Build from a CLEAN slate: wipe all data first, then watch it populate from zero
bun run --filter radius-admin test:simulate:fresh

# Faster churn:
SIM_MIN_MS=300 SIM_MAX_MS=1500 bun run --filter radius-admin test:simulate
```

Then open **`/dashboard`** in the browser and watch the Active Sessions table, revenue KPI, and AP
cards update without refreshing. Each simulator action also prints a timestamped log line in Terminal 2.

**Two ways to start:**
- **`test:simulate`** — populate on top of whatever's already in the DB (run after `test:seed`, or on
  its own — it bootstraps the catalog + owner if missing).
- **`test:simulate:fresh`** — wipe all data first (like `test:clear`), then build from scratch: 0
  customers → signups → top-ups → sessions. Best for watching the dashboard fill from empty.

> **Notes**
> - Needs only a **migrated schema**. If the schema doesn't exist yet, run `test:seed` (or
>   `db:migrate`) once first; the simulator will tell you if it's missing.
> - The owner login it ensures is **`owner@veent.test` / `password123`** (needs `BETTER_AUTH_SECRET`
>   set in `apps/admin/.env`).
> - Like the seed, it writes **straight to the DB** and never calls the network controller (no real
>   router grants).
> - It keeps balances consistent (top-ups/spends update the ledger and balance atomically), so the
>   `balance == ledger` invariant always holds while it runs.

---

## Login credentials

All staff share the password **`password123`**.

> **Mandatory TOTP (2FA).** Seeded staff have no authenticator enrolled yet, so the
> **first** login for any account is redirected to `/enroll-2fa` (confirm password → scan
> the QR / enter the key in an authenticator app → save backup codes → enter a code). After
> that, sign-in is two-step: password → `/login/2fa` (6-digit code **or** a backup code).
> You'll need a TOTP app (Google Authenticator, 1Password, Authy, …) to test as any staff
> member. The active-status check + device grant run only **after** the code is verified.

| Email | Role | Status | Expected behaviour |
|-------|------|--------|--------------------|
| `owner@veent.test` | owner | active | Full access — incl. **Staff** page and customer **wipe** |
| `adrian@veent.test` | admin | active | Normal admin — **no** Staff page (owner-only) |
| `bea@veent.test` | admin | active | Normal admin |
| `cleo@veent.test` | admin | active | Normal admin |
| `pia@veent.test` | admin | pending | Login should be **rejected** ("not activated yet") |
| `dane@veent.test` | admin | disabled | Login should be **rejected** ("not active") |

---

## Page-by-page test checklist

### `/login` + 2FA
- [ ] **First login** `owner@veent.test` / `password123` → redirected to `/enroll-2fa`;
      enroll (QR/key + backup codes + a code) → lands on `/dashboard`.
- [ ] **Later logins** (enrolled) → password → `/login/2fa` → enter a 6-digit code → `/dashboard`.
- [ ] A **backup code** works at `/login/2fa` in place of the TOTP (single-use).
- [ ] Wrong/expired code → "Invalid or expired code"; 10 bad codes / 15 min per IP → `429`.
- [ ] `pia@veent.test` (pending) → rejected "not activated" (after code verify, never before).
- [ ] `dane@veent.test` (disabled) → rejected "not active".
- [ ] Wrong password → "Sign in failed".

### `/dashboard`
- [ ] KPI cards show Gross Revenue (~₱6,600), Free-Time Grants, Avg. Session.
- [ ] 7-day revenue chart has bars across several days.
- [ ] **Active Sessions** table lists online devices with a live countdown (watch it tick).
- [ ] AP health cards reflect each AP's tone (online / degraded / offline).
- [ ] **Live updates (manual):** open `/users` in a second tab and block a user — the dashboard's active-sessions list updates via SSE without a refresh.
- [ ] **Live updates (simulator):** run `test:simulate` (see [Live simulation](#live-simulation-dynamic-dashboard-testing)) and watch the Active Sessions table, revenue KPI, and AP cards change on their own — no refresh.

### `/networks`
- [ ] All health tones present: Healthy, Degraded (Cafe Patio), Offline (Parking Lobby).
- [ ] Per-AP active-user counts are populated for online APs.
- [ ] Editing an AP's interface binding / location persists.

### `/map`
- [ ] Mapped APs appear as pins; **AP — Rooftop Deck** is unmapped and should **not** appear.
- [ ] Adding a location to Rooftop from `/networks` makes it appear here.

### `/users`
- [ ] Rows show the three tones: Blocked (3), warning (4) — labelled **No credits** (zero
      balance) or **Low Balance** (< ₱10), Active (13).
- [ ] ~8 users show as online.
- [ ] **Block** a user → they're cut off and flagged blocked. **Unblock** restores grant eligibility.
- [ ] **Kick** an online user → session cut, account stays unblocked.
- [ ] **Allow WiFi** (dev-only) on a user with a known MAC → comps a 60-min session.
- [ ] **Owner only:** request wipe code → code is printed to the dev console → wipe clears all customers.

### `/finance`
- [ ] Toggle `7d` / `30d` / `90d` — KPIs and the chart change (90d uses weekly buckets).
- [ ] Transactions table shows the full funnel: success, failed, expired, cancelled.
- [ ] Fund-source donut shows all methods (Card, GCash, Maya Wallet, ShopeePay, QR Ph).
- [ ] Some rows are unattributed ("Guest Checkout" / no package) — the table handles nulls.
- [ ] **CSV export** downloads a file matching the current filter.

### `/staff` (owner only)
- [ ] Visiting as a non-owner (`adrian@veent.test`) → **403**.
- [ ] As owner: table shows active / pending / disabled badges.
- [ ] Invite a new admin; enable/disable a member.
- [ ] **Promote admin→owner** — Crown opens a dialog requiring you to type the member's
      name **and** your TOTP code; wrong name keeps the button disabled, wrong code is
      rejected; correct both → they become owner.
- [ ] **Owner demotion/removal (needs ≥2 owners)** — promote a second admin first. An
      owner-row action opens a request (demote or remove) gated by type-name + TOTP; the
      "Pending owner changes" panel shows approval progress. The change executes only once
      **every other owner** approves (each via a TOTP step-up), then takes effect on the
      target's next request. With exactly 2 owners the initiator is already unanimous, so it
      executes immediately. The last owner can never be demoted/removed. Only the initiator
      can cancel a pending request.

---

## Governance E2E (Playwright)

The riskiest owner-gated flows have automated end-to-end coverage under `apps/admin/e2e/`
(`test:e2e` = `playwright test`).

```bash
bun run --filter radius-admin test:e2e
```

- **Throwaway DB.** The harness runs against its own database (`radius_admin_test`, default
  `postgres://root:root@localhost:5432/radius_admin_test`, override with `E2E_DATABASE_URL`) — it does
  **not** touch your dev `local` DB. See `apps/admin/e2e/config.ts`.
- **Auto-enroll + storageState.** `e2e/global-setup.ts` seeds the throwaway DB, then drives the owner
  through 2FA enrollment once and banks the session at `e2e/.auth/owner.json` (+ TOTP secret at
  `e2e/.auth/owner-totp.txt`), so specs start already signed-in. TOTP codes are generated by a small
  self-contained implementation in `e2e/totp.ts` (no external authenticator needed).
- **Specs** (`*.e2e.ts`, run serially): `promote` (admin→owner via TOTP step-up), `owner-change`
  (demote a second owner), `invite` (owner invites admin + dialog focus-return a11y), `wipe`
  (rejected without a valid code), `content-mfa` (content save requires a valid TOTP),
  `finance-export` (CSV export: enrolled owner 200 / anon 401 / pre-enrollment 403).

## Backend hardening — what to test (Phases 0–3)

The hardening pass (grant atomicity, rate limiting, env validation) is mostly covered by
**unit tests that need no server and no DB** — run those first; the manual steps only confirm
each limiter is actually *wired into* its endpoint.

### Automated (no server, no DB)

```bash
# from repo root — fake-db/fake-tx Proxy pattern, real Postgres not required
bunx vitest run grant-atomic      # spend+grant rolls back together
bunx vitest run rateLimit         # rate-limit + cron-allowlist decision logic
bunx vitest run maya-webhook      # re-fetch verification, status mapping, centavo conversion
```

### Manual wiring confirmations (need the relevant dev server)

| What | How | Expect |
|------|-----|--------|
| **Admin login limit** (10 / 15 min per IP) | POST `/login` with a wrong password 11× from one IP | 11th response is `429` |
| **2FA verify limit** (10 / 15 min per IP) | Enter a wrong code at `/login/2fa` 11× | 11th response is `429` |
| **Role step-up limit** (5 / 15 min per IP) | Submit a wrong TOTP on promote / owner-change 6× | 6th response is `429` |
| **Finance export limit** (20 / hr per admin) | Click CSV export >20× in an hour | eventually `429` |
| **SSE stream cap** (6 / user) | Open `/dashboard` in 7 tabs as one user | 7th SSE connection rejected `429` |
| **Admin email limit** | Request a wipe code 6× (owner) | 6th returns `429` (no email sent) |
| **Grant atomicity** | (customer app) buy a tier with the network controller forced to fail | balance **unchanged**, 502/503 "credits were not charged" |
| **Cron allowlist** | set `CRON_IP_ALLOWLIST="1.2.3.4"` in `apps/customer/.env`, restart, then `curl -i -X POST localhost:<port>/api/network/revoke -H "x-cron-secret: $CRON_SECRET"` | `403` (request IP not allowlisted) |

> The cron + grant rows exercise the **customer** app, so they need `cd apps/customer && bun run dev`
> (and the env change requires a restart). The login/export/SSE/email rows are admin-app.

### Env validation (boot fail-fast)

Temporarily unset a required var (e.g. `BETTER_AUTH_SECRET`) and start the app **as a prod build**
(`bun run build && node apps/admin/build`): it should abort at boot with a clear message. In
`bun run dev` the same condition only **warns** (dev convenience).

---

## Clearing test data

Stop the simulator first (Ctrl+C). Then pick based on what you want left behind:

| Goal | Command |
|------|---------|
| **Run another clean test** (wipe + repopulate) | `bun run --filter radius-admin test:seed` |
| **Leave the DB empty** (no test data, schema kept) | `bun run --filter radius-admin test:clear` |
| **Clear customers only**, in-app | `/users` → owner **wipe** (request code → printed to dev console → confirm) |

**`test:clear`** (`apps/admin/scripts/clear-test-data.ts`) truncates the data tables and cascades to
every dependent (auth rows, profiles, ledger, sessions, payments). It keeps the schema and the
migration-seeded `admin_role`. After it runs the DB is **empty** — no staff logins, customers, APs, or
packages — so run `test:seed` to repopulate before using the app again.

> For most "reset between runs" cases just use `test:seed` — it already does a clean rebuild. Reach for
> `test:clear` only when you specifically want an empty database.

---

## Re-seeding & troubleshooting

- **Reset to a clean state:** just run `bun run --filter radius-admin test:seed` again.
- **"Online" users disappeared:** active sessions expire in real time (≤ 3 hours). Re-seed to refresh.
- **Which database am I looking at?** The app and the seed use `DATABASE_URL` from `apps/admin/.env`
  (default `postgres://root:mysecretpassword@localhost:5433/local`). Inspect it with:
  ```bash
  PGPASSWORD=mysecretpassword psql -h localhost -p 5433 -U root -d local
  ```
  Do **not** assume a `docker exec ... psql` into a container is the same database — verify the port.
- **Verifying "active/unexpired" by hand:** the timestamp columns are timezone-naive and the DB
  session may run in a non-UTC zone, so a raw SQL `now()` comparison can look 8 hours off. The app
  compares in JavaScript (UTC) and is correct — trust the UI / a JS-side query, not SQL `now()`.
- **No staff can log in:** confirm `BETTER_AUTH_SECRET` is set in `apps/admin/.env` (the seed creates
  the password hashes with it; a mismatch makes every login fail).
