# Auth

Two separate better-auth instances. They never share anything.

| | Admin | Customer |
| --- | --- | --- |
| File | `apps/admin/src/lib/server/auth.ts` | `apps/customer/src/lib/server/auth.ts` |
| Cookie prefix | `radius-admin` | `veent-portal` |
| Tables | `admin_*` | `customer_*` |
| Secret | its own `BETTER_AUTH_SECRET` | its own `BETTER_AUTH_SECRET` |
| Login | Email and password plus mandatory TOTP 2FA | Phone OTP only |

## Isolation rule

- Never unify or cross-wire the two instances.
- A portal session must never validate on the admin app, and the reverse.
- This holds even on a shared parent domain.
- Both apps pin cookie `Secure` to the `ORIGIN` protocol, not `NODE_ENV`. A LAN `http` deploy works. A TLS deploy is fully Secure.
- If a shared secret or cookie is ever added, fix this doc.

## Admin

- `emailAndPassword` with `disableSignUp: true`. Staff are invited by the owner.
- `sendResetPassword` serves two flows. It branches on `callbackURL`: owner invite and self-serve forgot-password.
- `twoFactor({ issuer: 'RADIUS Admin' })` plugin. Table `admin_two_factor` stores the encrypted TOTP secret and backup codes.
- 2FA is mandatory. An enrollment gate in the `(app)/` server layout (`apps/admin/src/routes/(app)/+layout.server.ts`) enforces it.
- Session secret `BETTER_AUTH_SECRET` also encrypts staff 2FA seeds. Minimum 32 characters.
- Public routes: `apps/admin/src/routes/{login,login/2fa,enroll-2fa,forgot-password,reset-password,activate,logout}`.

### Role guards

`apps/admin/src/lib/server/auth-guard.ts` has `requireOwner()` and `requireManager()`.

- They read the role from the DB on every call. They never trust a session or client flag.
- They return a 403 `fail()` or `null`.
- Use one in every owner-only or manager-only form action.
- `getAdminRole`, `STAFF_ROLE`, and `MANAGER_ROLES` live in `@veent/core`.

### 2FA helpers

- `apps/admin/src/lib/server/twoFactor.ts`: `isTotpCode()`, `secretFromTotpUri()`. Used by `/login/2fa` and `/enroll-2fa`. Tested in `twoFactor.test.ts`.
- `apps/admin/src/lib/server/step-up.ts`: `verifyStepUp()`. It re-checks TOTP for an already signed-in user before a high-stakes action. Rate-limited per acting user (IP fallback). Used by `/content` and others.
- Login-2FA authenticates a fresh session. Step-up re-verifies a live session. They are different call sites that share `isTotpCode()`.
- The staff promote and owner-change flow has its own inline copy of the step-up pattern. It does not import `step-up.ts`. Check both when you change step-up behavior.
- Other staff-governance files: `owner-change.ts`, `wipe-verification.ts`, `postLogin.ts`, `adminBypass.ts`.

## Customer

- `emailAndPassword` is OFF. Signup is phone-only by design. It closes an account-takeover hole: an attacker could pre-register a `<phone>@...` email before the real owner's first SMS login.
- `phoneNumber` plugin: 6-digit OTP, 5-minute expiry, 3 attempts, `signUpOnVerification`.
- `getTempEmail` makes `randomUUID()@phone.veent.local`, because the better-auth user table needs an email.
- Fixed 12-hour session (`disableSessionRefresh: true`).
- `oneTimeToken` plugin: single use, hashed at rest, 2-minute TTL, server-only (`disableClientRequest: true`).

### CNA to browser handoff

A captive-network-assistant (CNA) webview can hand its session to the guest's real browser without a second OTP.

- `GET /auth/handoff?token=...` (`apps/customer/src/routes/auth/handoff/+server.ts`) verifies and consumes the one-time token. It mints a real browser session.
- OTP verify and resend actions and the pending-cookie UI: `apps/customer/src/routes/auth/verify/{+page.server.ts,+page.svelte}`.

## Schema and codegen

Auth tables are built by `packages/db/src/schema/_auth-factory.ts`: `authTables(prefix, extraUserColumns)` makes `{prefix}_user`, `_session`, `_account`, `_verification`.

- Admin adds `two_factor_enabled`. Customer adds `phone_number` and `phone_number_verified`.
- `auth-admin.ts` exports `adminUser/Session/Account/Verification` and `adminAuthSchema` (includes `adminTwoFactor`). `auth-customer.ts` exports the customer set and `customerAuthSchema`.
- `admin-two-factor.ts` defines `admin_two_factor`.

`bun run auth:schema` (in `apps/admin` or `apps/customer`) runs `better-auth generate` and writes `packages/db/src/schema/auth-{admin,customer}.generated.ts`. That output is a diff reference. The hand-written `auth-admin.ts` and `auth-customer.ts` are what `schema/index.ts` uses.

## Not auth

`ADMIN_WG_HOSTS` and `ADMIN_WG_IPS` configure walled-garden entries so the admin app is reachable over the WiFi LAN before login. They also drive auto-granting LAN internet to a device on admin sign-in (`docs/mikrotik/admin-lan-access.md`). This is network setup, not an auth isolation control. Do not mix it with the cookie and secret isolation above.

Staff governance (invite, promote, owner change, wipe) lives in `apps/admin/src/routes/(app)/staff` and `packages/core/src/services/{staff.ts,adminAccess.ts}`. Background: `process/features/admin-staff-governance/`.
