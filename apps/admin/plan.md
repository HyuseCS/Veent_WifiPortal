# Plan: Admin TOTP / MFA

Research + implementation plan for **two-factor auth (TOTP)** on the admin dashboard.
Source task: `To_Improve.md` → *System* → "Explore TOTP viability" + "Make admins and
owners activate TOTP/MFA on registration."

Status: **research complete, not yet implemented.** Locked decisions captured in §1.

---

## 0. Findings (is it viable?) — **Yes, cleanly. No new dependency.**

### Current reality vs. the docs
`CLAUDE.md` describes admin auth as "TOTP (admin)" — that is **aspirational; TOTP does
not exist yet.** Today `apps/admin/src/lib/server/auth.ts` is plain better-auth
**email + password** (`better-auth/minimal`), driven entirely by **server form actions**
(`auth.api.signInEmail`). There is **no `createAuthClient`** anywhere in admin — so TOTP
must be wired **server-side** via `auth.api.*`, not the client SDK most better-auth docs
assume.

### The plugin is already installed
better-auth `~1.4.21` ships the **`two-factor` plugin** (`better-auth/plugins/two-factor`)
with TOTP + backup codes built in. Endpoints surface as `auth.api.*`:

| Endpoint | `auth.api` method | Use |
|---|---|---|
| `/two-factor/enable` | `enableTwoFactor` | enrollment — returns `totpURI` + `backupCodes` |
| `/two-factor/get-totp-uri` | `getTOTPURI` | re-fetch the URI |
| `/two-factor/verify-totp` | `verifyTOTP` | confirm a 6-digit code (enroll + login) |
| `/two-factor/disable` | `disableTwoFactor` | turn off (password-gated) |

- **Secrets encrypted at rest** with `BETTER_AUTH_SECRET` (already set) — `secret` and
  `backupCodes` columns are stored encrypted, `returned: false`.
- On sign-in, a 2FA-enabled user makes `signInEmail` return **`{ twoFactorRedirect: true }`**
  instead of a session; the plugin sets a signed `two-factor` cookie. You complete login
  by calling `verifyTOTP` with that cookie present.

---

## 1. Locked decisions

| Decision | Choice | Implication |
|---|---|---|
| Enforcement | **Mandatory gate** | active staff with `twoFactorEnabled === false` are redirected to enrollment; can't reach the dashboard until enrolled |
| Secret display | **QR code** | render a scannable QR from the `otpauth://` URI (+ manual-key fallback); needs a small QR generator added to admin |
| Scope of first pass | Full TOTP (schema → plugin → login verify → enrollment → gate → QR) | — |

---

## 2. Schema change (migration required)

The plugin needs a `twoFactor` table and a `twoFactorEnabled` flag on the user. Both go in
the **admin** instance only (`packages/db/src/schema/auth-admin.ts` / `_auth-factory.ts`).

Plugin's required shape (from `two-factor/schema.mjs`):
- `admin_user.two_factor_enabled boolean` (default false)
- new `admin_two_factor` table: `id`, `secret` (text, encrypted), `backup_codes`
  (text, encrypted), `user_id` (FK → `admin_user.id`, cascade)

**Migration workflow (per CLAUDE.md — keep `db:migrate` portable):**
1. Add the `twoFactorEnabled` column to the admin user (via `_auth-factory` `extraUserColumns`,
   admin-only — the customer instance must NOT get it) and define `adminTwoFactor` in
   `auth-admin.ts`; add it to `adminAuthSchema` as `twoFactor`.
2. `bun run db:generate` → `packages/db/drizzle/00NN_*.sql`.
3. Make it idempotent: `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`.
4. `bun run db:migrate`, verify on a throwaway DB, **commit the generated SQL**.
5. Never hand-`ALTER` the live DB.

---

## 3. Files

### Changed
- `packages/db/src/schema/_auth-factory.ts` — allow / pass `two_factor_enabled` to the
  admin user (admin-only extra column).
- `packages/db/src/schema/auth-admin.ts` — define `adminTwoFactor`, add to `adminAuthSchema`.
- `packages/db/drizzle/00NN_*.sql` — generated migration (idempotent).
- `apps/admin/src/lib/server/auth.ts` — add `twoFactor({ issuer: 'RADIUS Admin' })` to the
  `plugins` array.
- `apps/admin/src/routes/login/+page.server.ts` — after `signInEmail`, if the result is
  `{ twoFactorRedirect: true }`, redirect to `/login/2fa` instead of `/dashboard`. (The
  status check + device-grant logic moves to *after* TOTP verification.)
- `apps/admin/src/routes/(app)/+layout.server.ts` — **mandatory gate**: active staff with
  `twoFactorEnabled === false` → redirect to `/enroll-2fa`.

### New
- `apps/admin/src/routes/login/2fa/+page.{server.ts,svelte}` — 6-digit code form; action
  calls `auth.api.verifyTOTP({ body: { code }, headers: event.request.headers })`. On
  success run the existing post-login work (status check, sign-out-if-not-active,
  best-effort device internet grant) then redirect to `/dashboard`.
- `apps/admin/src/routes/enroll-2fa/+page.{server.ts,svelte}` — enrollment: action calls
  `enableTwoFactor({ body: { password }, headers })`, renders the **QR** of `totpURI` +
  one-time **backup codes**, then confirms with `verifyTOTP`. Reachable by any
  authenticated-but-unenrolled staff member.
- A tiny QR renderer — `$lib/components/ui/QrCode.svelte` (SVG from the otpauth URI). See §5.

> Reuse the existing `Field` / `Button` UI components and the `/login` + `/activate` page
> shells for visual consistency.

---

## 4. Flows

**Login (2FA-enabled user)**
1. `/login` `?/signInEmail` → `auth.api.signInEmail` returns `{ twoFactorRedirect: true }`
   (plugin sets the signed `two-factor` cookie via `sveltekitCookies`).
2. Redirect to `/login/2fa`.
3. `?/verify` → `verifyTOTP({ code, headers })` → session established → run status check +
   device grant → `/dashboard`.

**Enrollment (mandatory, post-activation)**
1. Invitee finishes `/activate` (sets password, status → active) and signs in.
2. Layout gate sees `twoFactorEnabled === false` → redirect to `/enroll-2fa`.
3. `enableTwoFactor({ password })` → show QR + backup codes (one-time) → user scans →
   `verifyTOTP({ code })` flips `twoFactorEnabled = true` → `/dashboard`.

**Bootstrap owner** — the script-created first owner has no TOTP; they hit the same gate
on first login and enroll. No special-casing.

---

## 5. Gotchas / watch-items

- **Cookie propagation** — the verify step depends on the signed `two-factor` cookie set
  during `signInEmail`. `sveltekitCookies(getRequestEvent)` already wires Set-Cookie onto
  the response; the verify action **must pass `event.request.headers`** so the plugin reads
  the cookie back. Confirm in manual test.
- **QR rendering** — `totpURI` is an `otpauth://` string. No QR lib is installed and Lucide
  has none. Add the smallest viable SVG-QR generator (e.g. a ~single-file lib) confined to
  `apps/admin`. Always also show the **manual secret key** as a fallback for users who can't
  scan. *(ponytail: keep the lib tiny / SVG-only; no canvas, no image deps.)*
- **Backup codes** — shown **once** at enrollment; UX must force a "I've saved these" step
  before continuing. Recovery uses `verifyTOTP` with a backup code in place of a TOTP.
- **Order of post-login checks** — the current `signInEmail` action does status-check +
  device-grant **inline**. With TOTP those must move to **after** `verifyTOTP`, or an
  unverified half-login could grant internet. Important correctness point.
- **Rate limiting** — the existing per-IP login throttle covers `signInEmail`; add a similar
  cap on `/login/2fa` `?/verify` to blunt code brute-forcing (reuse `rateLimit` helper).
- **Disable path** — out of scope for v1 unless asked; `disableTwoFactor` exists and is
  password-gated. Mandatory enforcement means a disabled member would just be re-gated, so
  skip a self-serve disable for now.

---

## 6. Out of scope / deferred
- Self-serve "disable 2FA" UI (owner-driven reset is the recovery story if ever needed).
- Trust-this-device cookie (`trustDevice`) — the plugin supports it; skip for an admin tool.
- SMS / email OTP second factor (TOTP only). Customer OTP is a separate, teammate-owned path.
- WebAuthn / passkeys.

---

## 7. Testing
- **Unit/integration:** enrollment round-trip — `enableTwoFactor` → `verifyTOTP` with a code
  derived from the returned secret flips `twoFactorEnabled`; a wrong code is rejected.
- **Migration:** apply `00NN_*.sql` to a throwaway DB to confirm portability + idempotency.
- **Manual:** bootstrap owner → first login → forced enrollment → scan QR in an authenticator
  → land on dashboard; sign out → sign in → prompted for code → verify → dashboard; wrong
  code rejected; backup code works once.

---

## 8. Roadmap

Each phase ships something testable on its own; do them in order.

### Phase 0 — Schema + migration (DB)
- [ ] `_auth-factory.ts`: admin-only `two_factor_enabled` column.
- [ ] `auth-admin.ts`: `adminTwoFactor` table + add to `adminAuthSchema`.
- [ ] `db:generate` → idempotent `00NN_*.sql`; `db:migrate`; commit.
- **Gate:** migration applies cleanly to a throwaway DB.

### Phase 1 — Plugin + login verify
- [ ] `auth.ts`: add `twoFactor({ issuer })`.
- [ ] `login/+page.server.ts`: handle `twoFactorRedirect`; move post-login checks out.
- [ ] `login/2fa/` page: `verifyTOTP` + post-login work; rate-limited.
- **Gate:** a manually-enrolled user can complete the two-step login.

### Phase 2 — Enrollment + QR + mandatory gate
- [ ] `QrCode.svelte` (SVG from otpauth URI).
- [ ] `enroll-2fa/` page: `enableTwoFactor` → QR + backup codes → confirm.
- [ ] `(app)/+layout.server.ts`: redirect unenrolled active staff to `/enroll-2fa`.
- **Gate:** fresh owner is forced through enrollment on first login.

### Phase 3 — Tests + docs
- [ ] Enrollment/verify integration test.
- [ ] Update `CLAUDE.md` so "TOTP (admin)" is finally true; note the enrollment gate.
