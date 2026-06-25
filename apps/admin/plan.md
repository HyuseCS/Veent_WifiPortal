# Plan: Admin TOTP / MFA — Implementation Checklist

> **Status (2026-06-25): implemented.** Phases 0–3 done — schema + migration `0020`,
> two-factor plugin, two-step `/login/2fa`, mandatory `/enroll-2fa` gate with server-rendered
> QR + backup codes, unit tests (`twoFactor.test.ts`), docs updated. `svelte-check` clean
> (only the pre-existing MapPicker/leaflet error remains); 21/21 admin tests pass.
> **Remaining (human handoff):** manual browser E2E + a throwaway-DB migration apply (the
> SQL is guarded with `IF NOT EXISTS`/`DO`-block per convention, but the cross-machine apply
> hasn't been run).

Mandatory TOTP second factor for admin staff. Research complete; decisions locked.
Built on better-auth's **two-factor plugin** (already in `better-auth ~1.4.21`) — no
new auth dependency. Wired **server-side** via `auth.api.*` (admin has no
`createAuthClient`). Work top-to-bottom; each phase ships something testable.

Source task: `To_Improve.md` → *System* → "Explore TOTP viability" + "Make admins and
owners activate TOTP/MFA on registration."

## Locked decisions
- [ ] **Enforcement:** mandatory — active staff with `twoFactorEnabled === false` are
      gated to enrollment, can't reach the dashboard until enrolled.
- [ ] **Secret display:** QR (scannable) + manual-key fallback.
- [ ] **Scope v1:** schema → plugin → login verify → enrollment → gate → QR. No
      self-serve disable, no trust-device, no SMS/WebAuthn (see Out of scope).

---

## Phase 0 — Verify plugin + schema/migration (DB)
**Gate: migration applies cleanly to a throwaway DB; admin user has the column,
customer user does NOT.**

- [ ] Confirm `better-auth/plugins/two-factor` imports (it ships with 1.4.21).
- [ ] `packages/db/src/schema/_auth-factory.ts` — pass admin-only
      `two_factor_enabled: boolean('two_factor_enabled').default(false)` via the
      existing `extraUserColumns` arg (factory sig at `_auth-factory.ts:19`). Apply to
      the **admin** instance only.
- [ ] `packages/db/src/schema/auth-admin.ts` — add the extra column to the
      `authTables('admin', { … })` call; keep `adminAuthSchema` exporting
      `{ user, session, account, verification, twoFactor }`.
- [ ] New `packages/db/src/schema/admin-two-factor.ts` — define `adminTwoFactor`
      (`admin_two_factor`): `id`, `secret` (text, encrypted at rest), `backupCodes`
      (text, encrypted), `userId` FK → `admin_user.id` (cascade). Follow the 1:1
      `admin_profile` pattern in `packages/db/src/schema/admin.ts:42`.
- [ ] `packages/db/src/schema/index.ts` — `export * from './admin-two-factor'`.
- [ ] `bun run db:generate` → `packages/db/drizzle/0020_*.sql` (next free number).
- [ ] Make it idempotent: `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`
      (matches every existing migration).
- [ ] `bun run db:migrate`; verify on a throwaway DB; **commit the generated SQL**.
      Never hand-`ALTER` the live DB.

## Phase 1 — Plugin + two-step login
**Gate: a manually-enrolled user completes the two-step login; wrong code rejected.**

- [ ] `apps/admin/src/lib/server/auth.ts` — add `twoFactor({ issuer: 'RADIUS Admin' })`
      to `plugins`, **before** `sveltekitCookies(getRequestEvent)` (that one must stay
      last — comment at `auth.ts:61`).
- [ ] `apps/admin/src/routes/login/+page.server.ts` — **branch after `signInEmail`**
      (`:31`): if result is `{ twoFactorRedirect: true }` → `redirect(303,'/login/2fa')`
      and run **nothing else** (no session/userId yet). Otherwise (not-yet-enrolled
      user, real session) keep the current inline status-check (`:42–50`) + device
      grant (`:56–61`) + `/dashboard` redirect (`:63`) as-is.
- [ ] New `apps/admin/src/routes/login/2fa/+page.server.ts` + `+page.svelte`:
  - [ ] `+page.svelte`: 6-digit code form (reuse `Field` + `Button` from
        `$lib/components/ui/`; `inputmode="numeric"`, `autocomplete="one-time-code"`).
  - [ ] `?/verify` action: rate-limit first
        (`rateLimit('admin_login_2fa_ip', clientIp(event), 10, 15*60*1000)`, mirror
        `login/+page.server.ts:20`), then
        `auth.api.verifyTOTP({ body:{ code }, headers: event.request.headers })`.
  - [ ] On success **run the moved post-login work** in this order:
        `getStaffStatus` → sign-out-if-not-active → best-effort
        `resolveDeviceMac`/`grantAdminAccess` → `redirect(303,'/dashboard')`. (Copy the
        exact logic lifted from `login/+page.server.ts:42–61`.)
  - [ ] Backup codes work here too: `verifyTOTP` accepts a backup code in place of a
        TOTP — no separate endpoint needed.

## Phase 2 — Enrollment + QR + mandatory gate
**Gate: a fresh bootstrap owner is forced through enrollment on first login.**

- [ ] Add a minimal QR encoder lib to `apps/admin` (SVG-string output, e.g.
      `qrcode` → `toString(uri,{ type:'svg' })`). *(ponytail: encoder only; SVG string,
      no canvas/image deps; render with `{@html}` — no client component.)*
- [ ] New `apps/admin/src/routes/enroll-2fa/+page.server.ts` + `+page.svelte`:
  - [ ] `?/enable` action: `auth.api.enableTwoFactor({ body:{ password },
        headers })` → returns `totpURI` + `backupCodes`. Encode `totpURI` to an SVG
        string server-side; return SVG + the manual secret + backup codes.
  - [ ] `+page.svelte`: render QR via `{@html svg}`, show the **manual key** fallback,
        list backup codes with a forced "I've saved these" confirm before the code step.
  - [ ] `?/confirm` action: `verifyTOTP({ code, headers })` flips
        `twoFactorEnabled = true` → `redirect(303,'/dashboard')`.
  - [ ] Reachable by any authenticated-but-unenrolled staff member (no extra role gate).
- [ ] `apps/admin/src/routes/(app)/+layout.server.ts` — after the `locals.user` check
      (`:9–11`), if `user.twoFactorEnabled === false` → `redirect(302,'/enroll-2fa')`.
      (`hooks.server.ts:12–29` already re-checks active status, so the gate only adds the
      2FA condition.) Ensure `twoFactorEnabled` is exposed on the session/locals user.

## Phase 3 — Tests + docs
- [ ] Integration test: `enableTwoFactor` → `verifyTOTP` with a code derived from the
      returned secret flips `twoFactorEnabled`; a wrong code is rejected (mirror
      `apps/admin/src/**/*.spec.ts` style).
- [ ] Migration test: apply `0020_*.sql` to a throwaway DB — portable + idempotent.
- [ ] Manual E2E (browser + human handoff): bootstrap owner → first login → forced
      enrollment → scan QR in an authenticator → dashboard; sign out → sign in →
      prompted for code → verify → dashboard; wrong code rejected; backup code works
      once. *(Interactive/browser change → both an agent browser pass and a human
      verification handoff.)*
- [ ] Update `CLAUDE.md` so "TOTP (admin)" is finally accurate; note the enrollment gate.
- [ ] Tick the two `To_Improve.md` System items (TOTP viability + activate on registration).

## Gotchas (carried from research)
- [ ] **Cookie propagation:** every `verifyTOTP`/`enableTwoFactor` call must pass
      `headers: event.request.headers` so the plugin reads the signed `two-factor`
      cookie set during `signInEmail` (`sveltekitCookies` wires Set-Cookie already).
- [ ] **Secrets at rest:** `secret`/`backupCodes` are stored encrypted with
      `BETTER_AUTH_SECRET` (already required by `validateEnv`, `validateEnv.ts:14`),
      `returned:false`.
- [ ] **Order of post-login checks:** never grant device internet on an *unverified*
      half-login — that's why status-check + grant live in the `/login/2fa` verify
      action for 2FA users (Phase 1).
- [ ] **Bootstrap owner** has no TOTP → hits the same gate on first login, no
      special-casing.

## Out of scope (v1)
- [ ] Self-serve "disable 2FA" UI (owner-driven reset is the recovery story).
- [ ] Trust-this-device cookie (`trustDevice`).
- [ ] SMS/email OTP second factor (TOTP only; customer OTP is teammate-owned).
- [ ] WebAuthn / passkeys.
