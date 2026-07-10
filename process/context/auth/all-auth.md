---
name: context:all-auth
description: "Two isolated better-auth instances (admin TOTP 2FA + customer phone-OTP), the auth-guard pattern, and schema codegen — the auth group entrypoint/router"
keywords: auth, better-auth, 2fa, totp, step-up, otp, phone auth, cookie, session, auth-guard, auth:schema, login, enroll-2fa, handoff, one-time-token, isolation
related: [context:all-database]
date: 10-07-26
---

# Auth Context

This file is the canonical auth context entrypoint for veent-wifiportal.

Use it after `process/context/all-context.md` when the task needs auth flow, session, 2FA/step-up,
or role-gate changes.

---

## Scope

This group covers:

- The two independent `betterAuth()` instances — `apps/admin/src/lib/server/auth.ts` and
  `apps/customer/src/lib/server/auth.ts` — and the hard isolation contract between them (separate
  cookie prefixes, separate `BETTER_AUTH_SECRET`s, separate DB tables)
- Admin's mandatory TOTP 2FA: enrollment, the login-2FA step, and step-up re-verification for
  high-stakes actions
- Customer phone-OTP login, the pending-cookie contract, and the CNA→browser session handoff
  (`oneTimeToken` plugin)
- The `auth-guard.ts` role-gate pattern (`requireOwner` / `requireManager`) used by admin form
  actions
- `auth:schema` codegen commands and where the generated files land in `packages/db`
- Admin's public/pre-auth route surface (login, 2FA, enrollment, password reset, activation, logout)

It does not cover:

- Staff role/permission business logic beyond the guard functions themselves (`getAdminRole`,
  `STAFF_ROLE`, `MANAGER_ROLES` live in `@veent/core`) — see the `admin-staff-governance` feature
  folder for the full invite/promote/owner-change workflow
- Non-auth schema tables in `packages/db` — see the `database/` group
- MikroTik walled-garden / network-level admin LAN access provisioning (`ADMIN_WG_HOSTS` /
  `ADMIN_WG_IPS`, `docs/mikrotik/admin-lan-access.md`) — that is network infrastructure that happens
  to trigger on admin sign-in, not part of the auth flow itself (see Canonical Notes)

## Read When

Read this entrypoint when:

- touching either `betterAuth()` config (`apps/admin/src/lib/server/auth.ts`,
  `apps/customer/src/lib/server/auth.ts`)
- adding a new owner/manager-gated admin form action (needs `auth-guard.ts`)
- working on 2FA enrollment, login-2FA, or step-up re-verification (`twoFactor.ts`, `step-up.ts`,
  `/enroll-2fa`, `/login/2fa`)
- working on the customer OTP flow, the pending-cookie contract, or the CNA→browser handoff
  (`/auth/handoff`, `/auth/verify`)
- regenerating better-auth's Drizzle schema (`auth:schema`)
- adding a new admin pre-auth route (login / forgot-password / reset-password / activate / logout)

## Quick Routing

(No deeper auth docs yet — this entrypoint is the only file in the group. Add routing entries here
when a `two-instance-isolation.md`, `2fa-and-step-up.md`, or `customer-otp-flow.md` is split out.)

## Source Paths

- `apps/admin/src/lib/server/auth.ts` — admin `betterAuth()` instance: `emailAndPassword` with no
  self-signup (`disableSignUp: true`), a dual-purpose `sendResetPassword` callback that branches on
  `callbackURL` to serve both the owner-only invite flow and self-serve forgot-password,
  `twoFactor({ issuer: 'RADIUS Admin' })` plugin, `cookiePrefix: 'radius-admin'`
- `apps/admin/src/lib/server/auth-guard.ts` — `requireOwner()` / `requireManager()`: re-reads the
  role from the DB on every call (never trusts a session/client flag), returns a 403 `fail()` or
  `null`
- `apps/admin/src/lib/server/twoFactor.ts` — pure helpers: `isTotpCode()`, `secretFromTotpUri()`,
  shared by `/login/2fa` and `/enroll-2fa`; unit-tested in `twoFactor.test.ts`
- `apps/admin/src/lib/server/step-up.ts` — `verifyStepUp()`: per-acting-user (IP fallback)
  rate-limited TOTP re-check shared by `/content` and other high-stakes actions
- `apps/customer/src/lib/server/auth.ts` — customer `betterAuth()` instance: `emailAndPassword`
  fully OFF, `phoneNumber` plugin (6-digit OTP, 5-minute expiry, 3 attempts,
  `signUpOnVerification` with a random temp email), `oneTimeToken` plugin (2-minute TTL, hashed at
  rest, `disableClientRequest: true`), `cookiePrefix: 'veent-portal'`, fixed 12h session
  (`disableSessionRefresh: true`)
- `apps/customer/src/routes/auth/handoff/+server.ts` — `GET /auth/handoff?token=…`: verifies +
  consumes the CNA-minted one-time token and mints a real browser session
- `apps/customer/src/routes/auth/verify/{+page.server.ts,+page.svelte}` — OTP verify/resend form
  actions and the pending-cookie UI
- `packages/db/src/schema/_auth-factory.ts` — `authTables(prefix, extraUserColumns)` factory:
  builds `{prefix}_user/session/account/verification`; admin adds `two_factor_enabled`, customer
  adds `phone_number` / `phone_number_verified`
- `packages/db/src/schema/auth-admin.ts` — `adminUser/Session/Account/Verification` +
  `adminAuthSchema` (includes `adminTwoFactor`)
- `packages/db/src/schema/auth-customer.ts` — `customerUser/Session/Account/Verification` +
  `customerAuthSchema`
- `packages/db/src/schema/admin-two-factor.ts` — `admin_two_factor` table (encrypted TOTP secret +
  backup codes)
- Admin pre-auth route surface: `apps/admin/src/routes/{login,login/2fa,enroll-2fa,
  forgot-password,reset-password,activate,logout}`
- `apps/admin/package.json` / `apps/customer/package.json` — each app's `auth:schema` script

## Update Triggers

Update this group when:

- either app's `betterAuth()` config changes (plugins, cookie policy, session lifetime)
- the isolation contract changes (a shared secret or shared cookie should never be introduced — if
  it ever is, this doc is where that fact must be corrected)
- the 2FA enrollment/step-up flow changes
- the customer OTP or handoff-token flow changes
- `auth:schema` output paths or the generation command changes
- the admin pre-auth route surface gains or loses a route

## Canonical Notes

- **NEVER unify or cross-wire the two instances.** `apps/admin` (`cookiePrefix: 'radius-admin'`)
  and `apps/customer` (`cookiePrefix: 'veent-portal'`) are deliberately separate `betterAuth()`
  instances against physically distinct `admin_*` / `customer_*` tables, each reading its OWN
  `BETTER_AUTH_SECRET` from env — a portal session must never validate on the admin app and vice
  versa, even on a shared parent domain. Both apps pin cookie `Secure` to the `ORIGIN` protocol (not
  `NODE_ENV`), so a LAN/http deploy still works while a TLS deploy is fully Secure.
- **Schema generation:** `bun run auth:schema` in `apps/admin` runs
  `better-auth generate --config src/lib/server/auth.ts --output ../../packages/db/src/schema/auth-admin.generated.ts --yes`;
  the customer equivalent outputs `auth-customer.generated.ts`. The `.generated.ts` output is a
  reference/diff target — the hand-authored `auth-admin.ts` / `auth-customer.ts` (built on
  `_auth-factory.ts`) is what's actually wired into `schema/index.ts`.
- **Admin 2FA is mandatory, not optional** — enforced by an enrollment gate in the `(app)/` route
  group's server layout (not itself in this group's Source Paths list; check that layout when
  tracing the gate). `twoFactor({ issuer: 'RADIUS Admin' })` is the better-auth plugin;
  `admin_two_factor` stores the encrypted secret + backup codes.
- **Step-up vs login-2FA are different call sites** that share `isTotpCode()` from `twoFactor.ts`:
  login-2FA (`/login/2fa`) authenticates a fresh session; step-up (`step-up.ts` `verifyStepUp()`)
  re-verifies an ALREADY-authenticated user before a high-stakes action (the staff
  promote/owner-change flow carries its own inline copy of the same pattern rather than importing
  `step-up.ts` directly — check both when changing step-up behavior).
- **Customer signup is phone-only by design** — email/password is fully OFF
  (`emailAndPassword: { enabled: false }`) to close an account-collision/takeover surface (an
  attacker pre-registering a `<phone>@…`-style email before the real owner's first SMS login);
  `getTempEmail: () => randomUUID()@phone.veent.local` seeds an unguessable placeholder email since
  better-auth's user table requires one.
- **CNA→browser handoff** (`oneTimeToken` plugin): single-use, hashed at rest, 2-minute TTL,
  server-only generation (`disableClientRequest: true`) — lets a captive-network-assistant webview
  session hand off to the guest's real system browser without a second OTP.
- **`ADMIN_WG_HOSTS` / `ADMIN_WG_IPS`** (env vars) are about MikroTik walled-garden provisioning so
  the admin app is reachable pre-auth over the WiFi LAN, and about auto-granting LAN internet to a
  device on admin sign-in (`docs/mikrotik/admin-lan-access.md`) — this is network infrastructure
  triggered by sign-in, NOT an auth-level network isolation control. Don't conflate it with the
  cookie/secret isolation described above.
