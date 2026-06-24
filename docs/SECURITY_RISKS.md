# Security Risk Register — Veent WiFi Portal

> Living list of known security risks, their status, and who owns them. Keep it
> current: when you fix one, flip its status and note the commit/PR. Deep
> rationale for the architectural items lives in [`ARCHITECTURE_REVIEW.md`](./ARCHITECTURE_REVIEW.md).
>
> Last updated: 2026-06-24

## Status at a glance

| # | Risk | Severity | Status | Owner |
|---|------|----------|--------|-------|
| R1 | OTP send had no rate limit (SMS-bomb / credit drain) | High | ✅ Resolved | — |
| R2 | `rate_limits` table built but never wired in | High | ✅ Resolved | — |
| R3 | `emailAndPassword` enabled on a phone-only portal + guessable temp email | Medium | 🟡 In progress | teammate (email rate-limit work) |
| R4 | `/api/network/grant` spend→grant is not transactional | Medium | 🔴 Open | unassigned |
| R5 | Maya webhook signature scheme is an unconfirmed assumption | Medium | 🔴 Open | unassigned |
| R6 | `/register` admin hole mints an active owner per submit | High (dev-only) | 🔴 Open (must remove before prod) | unassigned |
| R7 | No rate limit on login/register, webhook, cron, SSE, Finance export | Low–Med | 🔴 Open | unassigned |
| R8 | No config fail-fast for `CRON_SECRET` / payment keys / `DATABASE_URL` | Low | 🔴 Open | unassigned |

Severity = impact × likelihood for *this* app at its current scale, not generic CVSS.

---

## R1 + R2 — OTP send rate limit ✅ Resolved

**Was:** `/login` and the verify-page `resend` called `sendPhoneNumberOTP` with no
throttle, and the purpose-built limiter (`consumeRateLimit`,
`packages/core/src/services/rateLimit.ts`) was wired into nothing. A script could
POST the login form thousands of times → thousands of billed texts to a victim's
number (each iTexMo send bills one credit — `TotalCreditUsed`).

**Fix:** `apps/customer/src/lib/server/otpRateLimit.ts` composes the existing core
limiter over **both** the phone number and the device MAC and is enforced *before*
the SMS gateway in:
- `apps/customer/src/routes/login/+page.server.ts`
- `apps/customer/src/routes/auth/verify/+page.server.ts` (`resend`)

Over budget → `fail(429)` with a "try again in ~N minutes" message; no SMS is sent.

**Policy:** 5 sends per identifier per rolling hour. Window is measured from the
last send; a *refused* attempt doesn't extend the penalty.

**Smoke test before relying on it:** hit the login form 6× with the same number —
the 6th returns 429 and sends no text.

**Note (verify-side):** OTP *verification* attempts are owned by better-auth's
`phoneNumber` plugin (`allowedAttempts: 3`, `auth.ts`). Confirmed configured.

---

## R3 — Email auth on a phone-only portal 🟡 In progress (teammate)

`auth.ts`: `emailAndPassword: { enabled: true }` activates `/sign-up/email` and
`/sign-in/email`, which the portal UI never uses. Combined with
`signUpOnVerification`, every phone user gets a **predictable** temp email:
`<phone>@otp.veent.local`. Because the address is derivable from the phone number,
an attacker could pre-create the account via `/sign-up/email` before the real
owner ever logs in by SMS — risking account collision/takeover and free account
spam.

**Direction:** if the portal is truly phone-only, set `emailAndPassword.enabled:
false`. If email auth is needed, the temp-email scheme must not be guessable and
the signup path needs its own rate limit. *Owned by the teammate doing the email
rate-limit work — left untouched here to avoid a merge conflict.*

---

## R4 — Grant path is not transactional 🔴 Open

In `grant/+server.ts`, `spendCredits` and `startSession` are two separate awaits.
If `startSession` (or the firewall drop) fails after credits are deducted, the
user paid and got nothing. Wrap them in one transaction with a compensating path,
or make the grant *claim* the spend the way the webhook claims the checkout
(`creditCheckoutIfUnsettled`). See ARCHITECTURE_REVIEW → "Other improvements".

## R5 — Maya webhook signature assumption 🔴 Open

`maya.ts` carries a `ponytail:` comment: the HMAC algorithm + header name for
webhook verification is an **assumption**. This is the credit-granting trust
boundary — confirm against the Maya dashboard before go-live. Wrong → reject all
real webhooks, or (worse) accept forged ones. (See also CLAUDE.md → Finance.)

## R6 — `/register` admin hole 🔴 Open (remove before prod)

`apps/admin/src/routes/register/` is an **ungated** open admin signup that creates
an active `owner` on every submit. CLAUDE.md already flags it as temp-delete-before-prod.
Until removed, at minimum rate-limit it; ideally just delete it (two-step removal
documented in CLAUDE.md).

## R7 — Remaining unthrottled endpoints 🔴 Open

Ranked in ARCHITECTURE_REVIEW → "What to rate limit": login/register form actions
(per IP, enumeration/credential throttle), `/api/network/grant` + free-time grant
(per user/MAC), webhook (cheap per-IP cap on unsigned junk) + IP-allowlist crons,
Finance CSV export/range queries (authenticated but heavy), and SSE connections
(cap concurrent streams per user). The same `consumeRateLimit` primitive now
proven on the OTP path covers most of these.

## R8 — Config fail-fast 🔴 Open

`BETTER_AUTH_SECRET` already fails fast (`otp.ts:36`). Extend the same boot-time
validation to `CRON_SECRET`, `DATABASE_URL`, and the payment keys so a
misconfigured deploy dies immediately instead of half-working.

---

## How to use this file

- Touching auth, payments, the router grant, or any new endpoint? Skim this first.
- Fixed something? Flip its status to ✅, add the date, and link the PR/commit.
- Found a new risk? Add a row + a short section. Keep severity honest for *this*
  app's scale.
