# Veent WiFi Portal — Full-System Security & Correctness Audit

**Date:** 2026-07-06
**Classification:** Internal — READ-ONLY audit, no remediation performed

## Scope

This audit covers the entire `veent_wifiportal` monorepo:

- `apps/admin` — owner/staff dashboard (better-auth, mandatory 2FA)
- `apps/customer` — captive-portal customer app (OTP auth, top-up, network grant)
- `apps/locator` — public, unauthenticated locator map
- `packages/core` — shared services (payments/reconciliation, sessions/grants, MikroTik controller, observability, rate limiting)
- `packages/db` — Drizzle schema and migrations

## Methodology

A multi-agent audit was run per security dimension (authn-authz, payments, grants-network, injection-input, secrets-config-deps, ratelimit-abuse-pii). Every candidate finding was then passed through an **adversarial verification** pass in which a second reviewer attempted to refute the claim against real source, adjusted severity where warranted, and assigned a verdict (`confirmed`, `needs-context`, or `refuted`). This report contains only findings that survived that verification. **This engagement was strictly read-only — no code was modified and no fixes were applied.**

---

## Executive Summary

### Severity tally (using corrected severities)

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 1 |
| Medium | 4 |
| Low | 9 |
| Info | 4 |
| **Total confirmed / needs-context** | **18** |
| Refuted (appendix) | 1 |

*(One finding is a `needs-context` verdict at Info severity; it is counted in the Info row above and detailed in its own section.)*

> **Follow-up pass (2026-07-07).** A second read-only pass extended coverage to vectors the first pass did not reach: OTP *verification* brute-force, payment-webhook authenticity, OTP randomness, SQL injection, RouterOS command injection / SSRF, money arithmetic, concurrency double-spend, CSRF, session-cookie flags, open redirect, and admin role/IDOR. It added one **High** (H-1, OTP-verify brute-force), one **Low** (L-10, map-action privilege asymmetry), and one **Info** (I-3, admin cookie flags rely on library defaults). Everything else on that list was verified **safe** — see *Additionally Verified Safe* below.

> **Remediation status (2026-07-07).** This report is preserved as the point-in-time, read-only audit
> (the engagement itself changed no code). Remediation shipped separately in two phases: everything
> except MAC-trust in commit `dc8b115` (Phase 1), and the MAC-trust phase on branch `system-audit-p2`.
> **M-2 is fully resolved** (cross-user revoke guard `revokeGuestUnlessShared` — verified on a real
> MikroTik). **M-1 / L-1 are _mitigated_, not fully closed:** the body/form MAC override was removed
> and a `scope:mac-trust` tripwire added, but `resolveMacForUser` still reads the captive-portal
> `?mac=` query param first, and that is client-influenceable **by design** (the router delivers a real
> device's MAC through it, and IP→MAC resolution returns null behind the hotspot NAT). So binding an
> arbitrary MAC at one's own credit cost remains a bounded residual — the cross-user _damage_ it used
> to enable is now contained by M-2. Per-risk status is tracked in `docs/SECURITY_RISKS.md` (see
> **R12**).

### Key takeaways

1. **One high-severity vulnerability was confirmed on the follow-up pass:** OTP *verification* is brute-forceable (H-1) — the verify action has no throttle and its only guard, better-auth's 3-attempt counter, is a non-atomic read-check-write that a concurrency race defeats, enabling customer account takeover (session + wallet). The next most consequential defects are the customer-side grant/network-authorization gaps, both rated **medium**.
2. **Client-supplied device MAC is trusted end-to-end (the theme of this audit).** The customer app never binds the target MAC to the caller's own device on either the JSON grant endpoint or the dashboard form actions. This underpins three distinct findings: self-funded access resale, a **remote targeted DoS** against another user's live session (cross-user router-bypass collision), and an unthrottled bind/unbind amplification path.
3. **SMS toll-fraud is the clearest abuse-cost risk.** The OTP send limiter is keyed only per phone number (and optional MAC) with no per-IP/global cap, so one source can drain the operator's paid SMS balance across an enumerable PH mobile number space.
4. **Rate-limit coverage is inconsistent.** The programmatic grant endpoint and webhook are throttled, but the dashboard grant actions, the top-up checkout action, and the forgot-password recipient axis are not.
5. **Money integrity fails closed but strands funds.** An amount-mismatch payment is marked settled and never credited or auto-refunded, with no alert wired up — a real operational/runbook gap, not an attacker exploit.
6. **Secrets/config hygiene needs attention operationally.** The single `BETTER_AUTH_SECRET` is reused across all three apps (contradicting the app's own docs), and it is validated for presence only, with no length/entropy enforcement. These are deployment-hardening issues confined to the local/deploy filesystem (nothing committed).

---

## Confirmed Findings

### High

---

#### H-1 — OTP verification is brute-forceable: no verify-side throttle, and the 3-attempt cap is a non-atomic counter defeated by a concurrency race (customer account takeover)

- **File:** `apps/customer/src/routes/auth/verify/+page.server.ts:28-49`; `apps/customer/src/lib/server/auth.ts:69-100`; better-auth `phone-number/routes.mjs:281-296`
- **Category / Dimension:** Authentication / OTP brute-force — authn-authz (follow-up pass)
- **Corrected severity:** High

**Description:** The `verify` form action calls `auth.api.verifyPhoneNumber({ body: { phoneNumber, code } })` (line 43) with **no** rate limit of any kind — only the sibling `resend` action is throttled (`enforceOtpSendLimit`, line 67). Because this is a *programmatic* `auth.api.*` call rather than an HTTP request through better-auth's router, better-auth's own HTTP rate limiter (`onRequestRateLimit`) never fires on it either. The only defense against guessing the 6-digit code (`otpLength: 6`, 1,000,000-value space, `expiresIn: 300` = 5-minute window, `auth.ts:71-73`) is the plugin's `allowedAttempts: 3` counter. That counter is implemented as a non-atomic read-modify-write: `findVerificationValue` (read), parse `attempts`, gate on `>= allowedAttempts`, then `updateVerificationValue` writing `attempts+1` on a wrong guess or `deleteVerificationValue` on cap/success (`routes.mjs:281,286-296`) — with no transaction, row lock, or atomic increment. Under Postgres read-committed, a burst of concurrent verify requests all read the same low `attempts`, all pass the `>= 3` gate, and last-writer-wins keeps the persisted counter near 1, so the cap-triggered delete rarely fires and the code survives burst after burst until it expires.

**Impact:** Remote account takeover of an arbitrary **customer** account. The only precondition is initiating a login for the victim's phone number (the login identifier — attacker-suppliable), which sends one SMS and issues the attacker a `pending` cookie. The attacker then floods `POST /auth/verify?/verify` with concurrent distinct guesses; the racy counter lets far more than 3 guesses through per code, and the 5-sends/hr cap only limits *fresh* codes, not guesses-per-code. A successful match signs the attacker in as the victim (`signUpOnVerification` / session cookie set via the sveltekit plugin), yielding the victim's session and spendable `credit_balance`. Blast radius is customer-tier only (no admin/owner reach).

**Evidence:**
```
verify/+page.server.ts:43   await auth.api.verifyPhoneNumber({ body: { phoneNumber: pending.phone, code } });  // no rateLimit / enforceOtpSendLimit — only `resend` (line 67) is throttled
auth.ts:71-73               otpLength: 6, expiresIn: 300, allowedAttempts: 3
routes.mjs:281-296          otp = findVerificationValue(...); [v, attempts] = otp.value.split(':');
                            if (attempts && parseInt(attempts) >= allowedAttempts) { deleteVerificationValue(...); throw TOO_MANY_ATTEMPTS; }
                            if (v !== code) { updateVerificationValue(otp.id, { value: `${v}:${+attempts+1}` }); throw INVALID_OTP; }   // read→check→write, non-atomic
```

**Verifier — confirmed (high confidence):** Every link verified against source. The `verify` action neither imports nor calls a throttle (grep: only `resend` calls `enforceOtpSendLimit`); the call is programmatic, so no HTTP limiter applies; the counter's read (`:281`) and write (`:293`) are separate awaited DB ops with no serialization. Sequentially the cap holds (3 wrong → code deleted; 5 codes/hr × 3 = 15 guesses/hr against 10⁶ is safe), so severity rests entirely on the race — which is genuinely winnable because nothing serializes the read-modify-write and nothing rate-limits the endpoint to blunt request volume. Rated **High** rather than medium because the outcome is full impersonation plus wallet theft (categorically worse than the medium DoS/resale/toll-fraud findings), tempered only by it being (a) probabilistic/throughput-dependent rather than single-shot and (b) confined to customer accounts. Even discounting the race, the total absence of a verify-side throttle is itself a real defect: the safe-sequential bound is owned entirely by a third-party library counter the app does not control. **Fix direction:** add an app-layer throttle to the `verify` action keyed on phone + MAC + IP (mirror `enforceOtpSendLimit`), and/or make the attempt counter atomic (`UPDATE ... WHERE split(attempts) < 3 RETURNING`, or `SELECT ... FOR UPDATE`).

---

### Medium

---

#### M-1 — Grant/bind endpoints trust a client-supplied MAC with no proof it belongs to the caller's device

- **File:** `apps/customer/src/routes/api/network/grant/+server.ts:33-56, 69-75`
- **Category / Dimension:** Authorization / MAC spoofing — grants-network
- **Corrected severity:** Medium (unchanged)

**Description:** `POST /api/network/grant` reads `macAddress` straight from the JSON body and only checks its shape via `isValidMac`. It never verifies the MAC is the authenticated caller's own device (via `resolveMacForUser` / the portal `?mac` cookie / router IP→MAC). The endpoint's own comment (lines 40-41) admits this. The dashboard form actions share the identical pattern: `const mac = String(form.get('mac') ?? '') || (await resolveMacForUser(...))`, so the client-supplied form value takes precedence over the server-resolved MAC (`dashboard/+page.server.ts:130,154,181,210`). Any authenticated user can therefore cause the app to write a router internet-bypass (`network.grant`) for an arbitrary MAC, remotely, without being on the same L2 segment.

**Impact:** An authenticated account can gift/resell network access to arbitrary devices: one free-time claim (15 min) can be pointed at any MAC per 12h cooldown, and a credit/points buy can grant paid internet to any chosen MAC (up to `MAX_DEVICES_PER_ACCOUNT`). It is also the root enabler of the cross-user collision/DoS (M-2).

**Evidence:**
```
if (!isValidMac(body.macAddress)) error(400, 'A valid macAddress is required');
... result = await startFreeAccessAndBindDevice(db, network, { userId: user.id, macAddress: body.macAddress });
// body.macAddress is never checked against the caller's actual device
```

**Verifier — confirmed (high confidence):** Validation is shape-only via `isValidMac` (line 42); the MAC flows straight into `startFreeAccessAndBindDevice`/`startPaidAccessAndBindDevice`. In `packages/core/src/services/sessions.ts:105-168` binding is keyed only on `(userId, macAddress, active)` with no ownership check. Dashboard actions prefer the client value over `resolveMacForUser`. Abuse is bounded by the per-account device cap and free-time cooldown and consumes the attacker's own credits, so this is an authorization gap (gift/resell to arbitrary device), not unlimited free access — consistent with medium.

---

#### M-2 — Cross-user router-bypass collision enables a remote targeted DoS on another user's live session

- **File:** `packages/core/src/services/sessions.ts:105-116, 967-991, 839-845`
- **Category / Dimension:** Walled-garden / access-control integrity — grants-network
- **Corrected severity:** Medium (unchanged)

**Description:** `network_sessions.mac_address` has only a plain index, no cross-user uniqueness (`packages/db/src/schema/customer.ts:255,280`), and `bindMacTx` scopes its existing-row lookup to `(userId, mac)` only. The MikroTik controller keeps at most one guest bypass binding per MAC. Combined with M-1, an attacker A holding any live window (even free time) can bind the victim's MAC M under A's own account — creating an `(A,M)` row while the `(V,M)` row and the single shared router bypass for M still exist — then call `unbindDevice` for A's row. `unbindDevice` verifies only that the row belongs to A, then issues `network.revoke(M, { tag: GUEST_BYPASS_TAG })`, removing the one shared bypass for M and knocking the victim offline even though the victim's own window/session is still live. `expireDueAccounts` and LRU eviction (`afterBind`) revoke by MAC the same way, so A's own session simply expiring also cuts the victim. `reconcileGuestBindings` only revokes drift — it never re-grants — so the victim stays offline until their next dashboard auto-bind.

**Impact:** Any authenticated customer can repeatedly and remotely knock a targeted victim off WiFi by binding+unbinding the victim's MAC (trivially sniffable on a shared hotspot). No credit cost is required (a free-time window suffices), and the attacker never needs to be on the victim's device.

**Evidence:**
```
unbindDevice:
  where(and(eq(networkSessions.id, input.sessionId),
            eq(networkSessions.userId, input.userId),
            eq(networkSessions.status, active)))
  then: if (row.macAddress) await network.revoke(row.macAddress, { tag: GUEST_BYPASS_TAG });
Schema: index('network_sessions_mac_address_idx').on(t.macAddress)  // no uniqueIndex
```

**Verifier — confirmed (high confidence):** Every link in the chain verified: dashboard actions prefer the client MAC; `bindMacTx` has no cross-user collision check; schema has a plain index only; MikroTik keeps exactly one guest bypass per MAC (`planGrant` returns noop for an already-bypassed MAC); `unbindDevice`/`revoke` key on mac-address + tag family only, cutting the victim's conntrack; `reconcileGuestBindings` never re-grants; `expireDueAccounts` gives a passive variant. No guard prevents the collision. Impact is a recoverable, remote, repeatable targeted DoS with no data/financial/privilege compromise — medium is appropriate.

---

#### M-3 — OTP send limiter has no per-source/per-IP cap — SMS toll-fraud drains operator credits

- **File:** `apps/customer/src/lib/server/otpRateLimit.ts:33-48`
- **Category / Dimension:** Abuse/DoS — ratelimit-abuse-pii
- **Corrected severity:** Medium (unchanged)

**Description:** `enforceOtpSendLimit()` keys only on the target phone number (5/hr) and, if present, the device MAC (5/hr). There is no per-IP or global cap. A single attacker can request 5 OTPs each for an unbounded set of distinct valid PH mobile numbers (09xx enumeration); the same gap exists on the direct better-auth `/api/auth/phone-number/send-otp` path (`auth.ts` `sendOTP` falls back to phone-only). Each send bills one SMS credit (iTexMo `TotalCreditUsed`), so aggregate operator cost is unbounded from one source. The doc comment claims this limiter stops "operator credits being drained," but it only protects individual victim numbers, not the aggregate.

**Impact:** SMS-pumping / toll fraud: one source triggers unlimited total SMS (5 per number across thousands of numbers), draining the operator's paid SMS balance and mass-spamming Filipino subscribers.

**Evidence:**
```
const checks = [consumeRateLimit(db, { key: { phoneNumber: phone }, max: OTP_SENDS_PER_HOUR, now })];
if (mac) { checks.push(consumeRateLimit(db, { key: { macAddress: mac }, ... })); }
// no IP/global key
```

**Verifier — confirmed (high confidence):** `consumeRateLimit` (`packages/core/src/services/rateLimit.ts:6-60`) supports only macAddress/phoneNumber/scope keys — no IP or global type. The MAC leg is attacker-optional (`getPortalContext(ev)?.mac` is undefined without the portal cookie), so a caller omitting the cookie is limited purely per-phone. `normalizePhone` accepts any valid PH mobile (~900M enumerable numbers), each granting 5 free SMS sends. The application-level defect is real; the only unobservable factor is a possible upstream proxy/WAF limit (deploy config outside the repo).

---

#### M-4 — Top-up checkout action has no rate limit (outbound Maya API + router-call amplification)

- **File:** `apps/customer/src/routes/top-up/+page.server.ts:77-173`
- **Category / Dimension:** Abuse/DoS — ratelimit-abuse-pii
- **Corrected severity:** Medium (unchanged)

**Description:** The `checkout` form action creates a Maya gateway checkout (`payments.createCheckout`, an outbound API call), inserts a `paymentCheckouts` row, and calls `network.openCheckoutAccess` (a MikroTik router call) on every submission. Unlike the sibling programmatic grant endpoint (`api/network/grant/+server.ts:53` → `rateLimit('grant_user', user.id, 20)`) and the webhook (`paymentWebhook.ts:55`), this action has no `rateLimit()` call. Any phone-verified guest (auth is trivially obtained via OTP) can loop the endpoint.

**Impact:** Authenticated request-amplification: unbounded outbound Maya checkout creations, DB row growth in `payment_checkouts`, and router `openCheckoutAccess` calls per attacker — resource exhaustion and third-party API abuse.

**Evidence:**
```
checkout: async (event) => { ... const checkout = await payments.createCheckout({ ... });
// no rateLimit('checkout_user', user.id, ...) anywhere in the action, while grant/webhook/handoff all rate-limit
```

**Verifier — confirmed (high confidence):** The `checkout` action authenticates only via `event.locals.user` and neither imports nor calls `rateLimit`; every submission performs the outbound Maya call, a router call, and a DB insert. `hooks.server.ts` has no global rate-limit middleware, so nothing upstream compensates. Exploitation requires an OTP account (bounding blast radius), but the missing throttle on an outbound-API + router + DB-write path where every sibling endpoint throttles is a genuine abuse/DoS gap — medium.

---

### Low

---

#### L-1 — Customer network grant/bind trusts a caller-supplied device MAC (broken object-level authorization)

- **File:** `apps/customer/src/routes/api/network/grant/+server.ts:33-59` (esp. 42); dashboard actions `apps/customer/src/routes/dashboard/+page.server.ts:130,154,210`
- **Category / Dimension:** Broken Object-Level Authorization / IDOR — authn-authz
- **Corrected severity:** Low (unchanged)

**Description:** The authenticated grant path validates only the *shape* of `macAddress` (`isValidMac`/`MAC_RE`) — it never binds the target MAC to the caller's own device. Any authenticated customer can POST `/api/network/grant` (or submit the dashboard `startFreeTime`/`buyTier`/`bindThisDevice` forms) with an arbitrary MAC and drop the router firewall for that device, spending their own free-time/credits. The captive-portal premise (the session you paid for goes to *your* device) is fully client-controlled. The code comment at lines 37-42 explicitly acknowledges this.

**Impact:** An authenticated guest can grant WiFi access (free-time or paid-from-own-wallet) to any device MAC — enabling access resale/sharing. Bounded because it consumes the caller's own wallet/cooldown, so no cross-account theft.

**Evidence:**
```
if (!isValidMac(body.macAddress)) error(400, 'A valid macAddress is required');
... // 'Format-validating here doesn't bind the MAC to the caller's own device, but it closes the malformed-input vector'
```

**Verifier — confirmed (high confidence):** The service (`sessions.ts:683-759`) binds the passed MAC to the caller's own `userId` and calls `network.grant({ macAddress })` with no check that the MAC was issued to that user; `resolveMacForUser` is only a fallback when the field is empty. Impact genuinely bounded to self-funded sharing, and partly inherent to a NATing captive portal (server can't reliably learn the true client MAC). Low is accurate.

*(Note: L-1 and M-1 describe the same underlying MAC-trust weakness from the authn-authz and grants-network dimensions respectively; M-1 carries the higher severity because it chains into the M-2 DoS.)*

---

#### L-2 — Mandatory admin 2FA is bypassable for not-yet-enrolled staff; device internet bypass is granted pre-2FA

- **File:** `apps/admin/src/routes/login/+page.server.ts:45-56`; `apps/admin/src/lib/server/postLogin.ts:46-68`; `apps/admin/src/routes/enroll-2fa/+page.server.ts:31-53`
- **Category / Dimension:** Authentication / 2FA enforcement gap — authn-authz
- **Corrected severity:** Low (unchanged)

**Description:** For an active staff account that has a password but has not yet enrolled TOTP, `signInEmail` establishes a full session from the password alone (no `twoFactorRedirect`). `finishStaffSignIn` then runs immediately and grants that device the admin internet bypass (`grantAdminAccess`) before any second factor exists. The `enroll-2fa` `enable` action requires only the account password, so a password holder can self-enroll their *own* authenticator and gain full dashboard access. This contradicts `postLogin.ts`'s stated intent ("never grant internet on an unverified half-login"). Admin login is rate-limited per-IP (10/15min) but has no per-account lockout.

**Impact:** An attacker who obtains/guesses the password of a staff member who set it via the activation link but has not completed first-login 2FA enrollment can bind their own TOTP, reach the full owner/admin dashboard, and receive an admin internet bypass on their own device.

**Evidence:**
```
postLogin.ts: 'Active staff get instant internet on their device: ... await grantAdminAccess(network, mac)' runs for the non-2FA path;
enroll-2fa enable action: auth.api.enableTwoFactor({ body: { password }, ... })  // password-only, outside the (app) 2FA gate
```

**Verifier — confirmed (high confidence):** All four claims verified. `activate/+page.server.ts:26-29` flips pending→active on password-set while `twoFactorEnabled` stays false, so the activated-but-unenrolled window is real and persists until first-login enrollment. The `(app)` gate redirects unenrolled users to `/enroll-2fa` but does not block self-enrollment, so it is not a mitigation. Exploitation is gated on prior compromise/guess of the invitee's own password during a narrow window — the inherent first-login-enrollment gap of mandatory-2FA designs. Low is appropriate.

---

#### L-3 — Credit path validates amount but never validates currency

- **File:** `packages/core/src/services/reconcilePayments.ts:209-222`
- **Category / Dimension:** amount/currency tampering — payments
- **Corrected severity:** Low (unchanged)

**Description:** `creditCheckoutIfUnsettled` asserts only that the gateway-charged amount (`args.amountMinor`) equals the frozen checkout amount (`expectedMinor`). It never asserts `evt.currency` is PHP or matches the checkout (comment at 209-210 rationalizes this). Compounding it, `maya.ts` `toPaymentEvent` defaults a missing currency to `'PHP'` (`packages/core/src/integrations/payments/maya.ts:192`, `currency: payment.currency ?? 'PHP'`), so a payment with no/garbled currency is silently treated as PHP. A "100 USD" payment and a "100 PHP" checkout would pass the numeric check identically.

**Impact:** Not attacker-reachable in the current deployment: checkouts are always created server-side with `currency:'PHP'` (`top-up/+page.server.ts:176`) under the merchant's own Maya account, and a payer cannot change the currency of a PHP checkout. Defense-in-depth gap — relevant if a non-PHP or mixed-currency market is ever added.

**Evidence:**
```
reconcilePayments.ts:213-221
const expectedMinor = Math.round(Number(claimed.amount) * 100);
if (args.amountMinor !== expectedMinor) { ... return { credited: false, reason: 'amount_mismatch' }; }
// no comparison of evt.currency anywhere in the claim/credit transaction
```

**Verifier — confirmed (high confidence):** The missing-currency-assertion path is real exactly as described, but not attacker-reachable in the current single-currency PHP deployment. A true latent hardening gap, not an exploitable vulnerability today. Low is appropriate.

---

#### L-4 — Dashboard grant/bind actions have no rate limiting (only the JSON API endpoint does)

- **File:** `apps/customer/src/routes/dashboard/+page.server.ts:125-146, 149-201, 205-225`
- **Category / Dimension:** rate limiting / abuse — grants-network
- **Corrected severity:** Low (unchanged)

**Description:** `POST /api/network/grant` throttles with `rateLimit('grant_user', user.id, 20)` (`grant/+server.ts:45`), but the equivalent SvelteKit form actions `startFreeTime`, `buyTier`, and `bindThisDevice` have no rate limiting. `bindThisDevice` adds no time and accepts an arbitrary client MAC (line 210), so an attacker with a live window can hammer it to rapidly grant/evict/revoke arbitrary MACs with no throttle, amplifying the M-2 collision/DoS.

**Impact:** Removes the per-user throttle the programmatic endpoint relies on, letting an attacker script rapid arbitrary-MAC bind/unbind cycles against the router (spurious LRU evictions, repeated victim-MAC revokes) at will.

**Evidence:**
```
grant/+server.ts:45  const rl = await rateLimit('grant_user', user.id, 20); if (!rl.allowed) error(429, ...)
// no equivalent call in startFreeTime / buyTier / bindThisDevice
```

**Verifier — confirmed (high confidence):** `hooks.server.ts` has no global throttle, so nothing else covers these actions; `bindThisDevice` takes the MAC from client form data (line 210), shape-validates with `MAC_RE` only, and adds no time. Low is appropriate: it requires authentication, `startFreeTime`/`buyTier` have natural limits (12h cooldown; credits/points actually spent), and the more damaging amplification is contingent on M-2. Standalone impact is unthrottled churn of the caller's own binding table via `bindThisDevice`.

---

#### L-5 — BETTER_AUTH_SECRET accepted with no length/entropy validation

- **File:** `apps/admin/src/lib/server/validateEnv.ts:24-33`
- **Category / Dimension:** Weak env validation / insecure defaults — secrets-config-deps
- **Corrected severity:** Low (unchanged)

**Description:** `validateEnv` only checks that `BETTER_AUTH_SECRET` is present (`REQUIRED.filter((k) => !env[k])`); it never enforces a minimum length or entropy despite the `.env.example` comment demanding "32+ chars in prod." Per `apps/admin/src/lib/server/auth.ts`, this same secret encrypts the stored 2FA TOTP secrets and backup codes in `admin_two_factor`. A short/low-entropy value is silently accepted in production.

**Impact:** A weak auth secret weakens signing of admin session cookies and at-rest encryption of staff 2FA seeds/backup codes; if guessable, an attacker can forge admin sessions or decrypt second-factor material. The documented guardrail is not enforced.

**Evidence:**
```
const REQUIRED = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'ORIGIN'] as const;
const missing: string[] = REQUIRED.filter((k) => !env[k]);  // presence only, no length/entropy check
```

**Verifier — confirmed (high confidence):** Presence-only validation confirmed; `.env.example:23` documents "32+ chars in prod," so the guardrail is genuinely unenforced. `auth.ts:103` confirms the twoFactor plugin stores TOTP secret + backup codes encrypted with the secret. Caveat: no code path ships a weak default (`scripts/setup-prod.ts:169` auto-generates via `gen(32)`; the cited 36-char UUID carries ~122 bits). Exploitation requires an operator to deliberately choose a weak secret. Real but low-severity hardening gap.

---

#### L-6 — Locator app ships no security headers

- **File:** `apps/locator/src/hooks.server.ts:1-29`
- **Category / Dimension:** Missing security headers — secrets-config-deps
- **Corrected severity:** Low (unchanged)

**Description:** Unlike the admin (`apps/admin/src/hooks.server.ts` `setSecurityHeaders`) and customer apps, the locator app's `handle` is just `Sentry.sentryHandle()` with no wrapper setting `X-Frame-Options`, `Content-Security-Policy` (frame-ancestors), `X-Content-Type-Options: nosniff`, or `Referrer-Policy`.

**Impact:** The public locator map can be framed (clickjacking) and served without MIME-sniffing protection. Low impact because the locator is unauthenticated and read-only, but an inconsistency with the other two apps' hardened baseline.

**Evidence:**
```
export const handle = Sentry.sentryHandle();  // no setSecurityHeaders; no X-Frame-Options/CSP/nosniff anywhere in file
```

**Verifier — confirmed (high confidence):** File exports `handle = Sentry.sentryHandle()` (line 26) with no header wrapper; admin (`setSecurityHeaders` 43-52, applied line 93) and customer (38-42, applied line 64) both harden. Locator is unauthenticated and read-only, so clickjacking has no privileged action to abuse — impact genuinely low. Code-level fact, not deploy-config dependent.

---

#### L-7 — Working-tree .env files hold live secrets and reuse one auth secret across all three apps

- **File:** `apps/admin/.env` (also `apps/customer/.env`, `apps/locator/.env`)
- **Category / Dimension:** Secrets handling — secrets-config-deps
- **Corrected severity:** Low (unchanged)

**Description:** The real `.env` files (correctly gitignored — verified not tracked and never in git history) contain live-looking secrets: a Sentry auth token with mutate scope, a Resend API key, the MikroTik router password, and `OWNER_PASSWORD="password123"`. Critically, `apps/admin/.env`, `apps/customer/.env`, and `apps/locator/.env` all set the *same* `BETTER_AUTH_SECRET`, contradicting `apps/admin/.env.example` which states the admin secret must be "DISTINCT from the customer app." `bootstrap-owner` only enforces password length ≥ 8, so `password123` passes.

**Impact:** A shared auth secret removes the intended isolation between the low-value public locator/customer apps and the owner-privileged admin app: a leak of the secret from any one app lets an attacker forge admin sessions and decrypt admin 2FA seeds. Live tokens/passwords in the working tree risk accidental exposure (container image, backup, non-ignored path). Not committed, so contained to the local/deploy filesystem.

**Evidence:**
```
admin .env: BETTER_AUTH_SECRET="sANS5eVFOM7UcmmICyWZvIMl8sLjVI/gHOkQ4xrT7P0="  (identical to customer & locator .env)
OWNER_PASSWORD="password123"; SENTRY_AUTH_TOKEN="sntryu_2c09..."; RESEND_API_KEY="re_KAtH2YgQ_..."
```

**Verifier — confirmed (high confidence):** All three `.env` files set the identical secret (admin:11, customer:20, locator:17) while `.env.example:23` demands distinctness. `bootstrap-owner.ts:37` only rejects <8 chars, so `password123` passes with no complexity/breach check. `git check-ignore` confirms all three are ignored and `git log --all` shows no history — exposure confined to the working tree/deploy filesystem. Low is fair for a local dev environment with nothing committed.

---

#### L-8 — Raw device MAC address written to server logs (stdout, unscrubbed)

- **File:** `apps/customer/src/lib/server/network-location.ts:137, 182-183`
- **Category / Dimension:** PII/logging — ratelimit-abuse-pii
- **Corrected severity:** Low (unchanged)

**Description:** `observability.ts` explicitly classifies MAC addresses as PII and masks them in every Sentry event, but that scrubber runs only on Sentry send hooks — not on `console.*`. `logResolved()` `console.info`-logs the raw MAC (`{ mac, apName }`) on the device-mac resolution branch (line 182 passes `mac`, line 137 logs it), and line 183 `console.warn`-logs the raw mac on failure. These land in server stdout/log files unmasked. Line 38 similarly logs the raw client IP.

**Impact:** Device MAC addresses (persistent device identifiers / PII) accumulate in plaintext server logs, inconsistent with the codebase's own PII-redaction policy; log access or shipping to an aggregator exposes them.

**Evidence:**
```
function logResolved(via, detail, networkId) { console.info('[topup] AP resolved', { via, ...detail, networkId }); }
// called as logResolved('device-mac', { mac, apName }, byMac); and console.warn('[topup] MAC→AP unresolved', { mac, apName });
```

**Verifier — confirmed (high confidence):** All cited lines confirmed. `packages/core/src/observability.ts` `MAC_RE` (35-36) treats MACs as PII and `maskString` masks them (58), but the scrubber (`scrubEvent`) is wired solely into Sentry's `beforeSend`/`beforeSendTransaction` (234-235). No hook intercepts `console.*`, so raw MAC and IP land in stdout unmasked. Exploitable only with log-store access — low.

---

#### L-9 — Forgot-password reset emails capped only per-IP, not per-recipient

- **File:** `apps/admin/src/routes/forgot-password/+page.server.ts:15-31`
- **Category / Dimension:** Abuse/DoS — ratelimit-abuse-pii
- **Corrected severity:** Low (unchanged)

**Description:** The forgot-password action rate-limits only on client IP (5/15min) and calls `auth.api.requestPasswordReset` directly, which invokes `sendResetPassword → mailer.send` (paid Resend email). It does not call `checkAdminEmailLimit()`, which the invite path uses to enforce a per-recipient cap (`PER_RECIPIENT_PER_HOUR=5`). So a distributed source (rotating IPs) can mail-bomb a single staff address with reset emails.

**Impact:** Reset-email flooding / Resend cost + sender-domain reputation abuse against a specific staff mailbox from many IPs; the per-recipient defense that exists for invites is not applied here.

**Evidence:**
```
await rateLimit('admin_forgot_ip', clientIp(event), 5, 15 * 60 * 1000);
await auth.api.requestPasswordReset({ body: { email, redirectTo: '/reset-password' } });  // no checkAdminEmailLimit(email)
```

**Verifier — confirmed (high confidence):** The staff-invite path (`staff/+page.server.ts:165`) does call `checkAdminEmailLimit(email, actorId)` before its identical `requestPasswordReset`; `emailRateLimit.ts:14,33-38` defines the IP-independent `PER_RECIPIENT_PER_HOUR=5` cap that is missing from forgot-password. Bounding factors keep it low: `requestPasswordReset` only sends when the email matches an existing account (enumeration-safe, targets only real staff), and impact is Resend cost + domain reputation, not account compromise.

---

#### L-10 — Map AP-location actions are writable by any staff, while the Networks records they represent are owner-only (privilege asymmetry)

- **File:** `apps/admin/src/routes/(app)/map/+page.server.ts:75-171`
- **Category / Dimension:** Authorization / privilege asymmetry — authn-authz (follow-up pass)
- **Corrected severity:** Low

**Description:** The admin authorization model is otherwise robust: owner-only actions consistently call `requireOwner` (`auth-guard.ts`), which re-reads the role from the DB rather than trusting the session, and the `(app)` hook gates auth + 2FA before any action runs (`hooks.server.ts:83-90`). The map actions `addPlace`/`updatePlace`/`nameCluster`/`deletePlace` have **no** `requireOwner` gate, so any active staff (admin role) can create, move, rename, or delete AP-location markers — whereas the Networks records those markers represent are owner-only (`nav.ts` marks Networks/Staff/Content `ownerOnly`, but not `/map`). This appears deliberate, and impact is low: markers are display-only, `network_id` is a loose link with no FK (per the code comment), and every action is reversible.

**Impact:** A non-owner staff member can alter or delete the operator's AP location map (display-only geography), a lower-trust action than the owner-gated Networks management it visually mirrors. No data loss beyond reversible marker edits; flagged as a privilege-boundary inconsistency to confirm against intent.

**Evidence:**
```
map/+page.server.ts:75-171   addPlace / updatePlace / nameCluster / deletePlace  // no requireOwner(...) — cf. networks/staff/content actions which all call requireOwner
```

**Verifier — confirmed (high confidence):** The four map actions run under the `(app)` auth+2FA gate but call no `requireOwner`, unlike the Networks/Staff/Content/user-delete actions. Deliberate per `nav.ts` (no `ownerOnly` on `/map`) and low impact (display-only, reversible, loose `network_id`). Note the same intentional pattern for `users` block/unblock/kick/allowWifi and `sentry` resolve/ignore — those are moderation/triage actions the code documents as staff-accessible, with the destructive `users` delete/wipe correctly owner-gated. If map placement is considered network configuration, add `requireOwner`; otherwise no action needed. Low.

---

### Info

---

#### I-1 — Amount/overpayment mismatch settles the checkout but neither credits nor refunds (funds trapped, manual-only remediation)

- **File:** `packages/core/src/services/reconcilePayments.ts:213-222`
- **Category / Dimension:** money integrity / reconciliation — payments
- **Corrected severity:** Info (unchanged)

**Description:** When a verified paid event's amount ≠ the recorded checkout amount (under- or over-payment, or an admin editing `fiatCost` under a stale checkout), the code keeps the atomic claim (checkout marked `settled`) to stop retries, logs a warning, and returns `credited:false` with reason `amount_mismatch`. The buyer has genuinely paid Maya but receives no credits and no automatic refund; the settled state means later webhook/reconcile passes read `already_settled` and never revisit it. Remediation is entirely manual/out-of-band.

**Impact:** A real money-integrity exposure for the buyer (paid, received nothing) rather than an attacker exploit — it fails closed against crediting (correct for security) but leaves funds stranded with no automated refund/alert-to-refund SLA. Worth confirming the mismatch warning is wired to an alert plus a documented refund runbook.

**Evidence:**
```
reconcilePayments.ts:214-221
if (args.amountMinor !== expectedMinor) { console.warn('[credit] amount mismatch — refusing to credit', {...}); return { credited: false, reason: 'amount_mismatch' }; }
// the claim update at 191-195 already set status='settled' and is not rolled back
```

**Verifier — confirmed (high confidence):** Lines 191-195 set `status='settled'` inside the transaction; the mismatch branch does a bare `return` (not a throw, unlike the non-finite branch at 170-174), so the settled claim commits and is never rolled back. The caller (`apps/customer/src/lib/server/paymentWebhook.ts:189-201`) does nothing with `amount_mismatch` beyond a generic `console.info`; grep confirms the only surfacing is the `console.warn` string — no Sentry/alert hook and no automated refund path. Correctly characterized as fail-closed; trigger requires a genuine gateway-vs-checkout amount divergence (rare). Info is appropriate — an operational alerting/runbook gap, not an exploitable vulnerability.

---

#### I-2 — Customer captive portal sets no script-src/style-src CSP (XSS defense-in-depth gap)

- **File:** `apps/customer/src/hooks.server.ts:38-46`
- **Category / Dimension:** XSS — injection-input
- **Corrected severity:** Info (unchanged)

**Description:** `setSecurityHeaders` emits only `Content-Security-Policy: frame-ancestors 'self'` (plus `X-Frame-Options`, `nosniff`, `Referrer-Policy`). There is no `script-src`/`style-src` directive, so the browser has no CSP-level mitigation if a script-injection sink is ever introduced. The admin app is the same (`apps/admin/src/hooks.server.ts:46`, `frame-ancestors 'none'`). This is a deliberate, documented scoping decision (comment says a full script/style CSP is out of scope pending nonce wiring), and no actual XSS sink exists in current code (the sole `{@html}` is server-generated QR SVG never round-tripped) — defense-in-depth only.

**Impact:** If a future change introduces a reflected/stored script sink, there is no CSP fallback to blunt it; the customer portal frequently runs over plain HTTP on the LAN, raising the value of a `script-src` baseline.

**Evidence:**
```
h.set('Content-Security-Policy', "frame-ancestors 'self'");  // no script-src/style-src directive anywhere
```

**Verifier — confirmed (high confidence):** Both apps set only `frame-ancestors` with explicit comments that a full CSP is intentionally deferred pending nonce wiring. No active XSS sink: the only `{@html}` (admin `enroll-2fa/+page.svelte:71`) renders server-generated `qrSvg` documented as not round-tripped from client input. Real defense-in-depth gap, not exploitable today — Info.

---

#### I-3 — Admin session-cookie security attributes rely on better-auth defaults rather than being pinned (parity gap)

- **File:** `apps/admin/src/lib/server/auth.ts:100`
- **Category / Dimension:** Session hardening — secrets-config-deps (follow-up pass)
- **Corrected severity:** Info

**Description:** The customer app pins its session-cookie attributes explicitly — `httpOnly: true`, `sameSite: 'lax'`, and `secure` bound to the `ORIGIN` protocol (`apps/customer/src/lib/server/auth.ts:57-67`, a documented deliberate choice). The admin app sets only `advanced: { cookiePrefix: 'radius-admin' }` and inherits better-auth's defaults. Those defaults are safe (`secure = baseURL.startsWith('https://')`, `httpOnly: true`, `sameSite: 'lax'`), so admin cookies are Secure/HttpOnly/Lax in an HTTPS deployment — but the posture is implicit and would silently follow a library default change, unlike the customer app's pinned attributes.

**Impact:** No vulnerability today — the resolved attributes match the customer app's hardened baseline. Purely a robustness/parity observation: pin `defaultCookieAttributes` (and `useSecureCookies`) on the admin instance so the owner-privileged app's cookie security is explicit rather than inherited.

**Evidence:**
```
admin auth.ts:100   advanced: { cookiePrefix: 'radius-admin' }   // no defaultCookieAttributes / useSecureCookies — cf. customer auth.ts:57-67 which pins httpOnly/sameSite/secure
```

**Verifier — confirmed (high confidence):** Admin sets only the cookie prefix; better-auth's default (`secure = baseURL.startsWith('https://')`, `httpOnly`, `sameSite: 'lax'`) yields a safe posture that matches the customer app under HTTPS. Not exploitable — a parity/robustness nit, correctly Info.

---

## Additionally Verified Safe (follow-up pass)

The 2026-07-07 pass examined these vectors and found **no exploitable defect**; recording them so the coverage is explicit:

- **Payment-webhook authenticity (SAFE):** The Maya webhook is transport-unsigned, but forging a "paid" event cannot mint credit. `verifyWebhook` reads only a payment `id` from the body and authoritatively re-fetches `GET /payments/v1/payments/{id}` with the merchant secret key (`maya.ts:203-217,320-337`), trusting that response, not the body. Attribution requires a real `payment_checkouts` row matching the 32-hex `referenceId` nonce (`paymentWebhook.ts:96-126`); crediting is an atomic claim idempotent on `externalTransactionId` (`reconcilePayments.ts:191-195`, `credits.ts:124`). The unauthenticated surface is DoS-scoped only and already has a 120/min/IP cap.
- **OTP generation randomness (SAFE):** `generateOTP` → better-auth `generateRandomString(size, '0-9')` uses `crypto.getRandomValues` with rejection sampling (no modulo bias); no `Math.random`.
- **SQL injection (SAFE):** Every `sql\`\`` in `packages/core` / `packages/db` binds values as Drizzle parameters (e.g. `sessions.ts:870`, `staff.ts:132`, `credits.ts`/`points.ts` arithmetic); no `sql.raw`, no interpolated `db.execute`.
- **RouterOS command injection / SSRF (SAFE):** The binary RouterOS API (`node-routeros`) sends each attribute as a length-prefixed word, so a newline/space/`=` inside a MAC or comment cannot frame a second command (`mikrotik.ts:433-444`); request-reachable MACs are format-validated and uppercased, all comment tags are internally generated, and router host/port come only from env (`network.ts:10`) — never request-derived.
- **Money arithmetic (SAFE):** Amounts are never client-supplied (all derive from server-side package rows); minor-unit conversion is integer-safe with NaN guards (`maya.ts:92-94`, `reconcilePayments.ts:170,213-214`); negative/zero guards exist at every spend/earn seam (`credits.ts:110,159`, `points.ts:48,96`); points-earn is floored on the validated charged amount.
- **Concurrency / double-spend (SAFE):** Credit/points spend use conditional `UPDATE ... WHERE balance >= amount` (row-lock serialized); free-time claim uses conditional `UPDATE ... WHERE lastFreeSessionAt <= cutoff RETURNING`; paid buy runs spend+bind+grant in one transaction with `SELECT ... FOR UPDATE`; payment-credit claim is an atomic single-winner `UPDATE ... RETURNING` plus `externalTransactionId` idempotency. No check-then-write double-spend.
- **CSRF (SAFE):** Neither app disables SvelteKit's default `checkOrigin` (no `svelte.config.js` override). The JSON grant endpoint is not CSRF-reachable — session cookie is `SameSite=Lax`, a cross-origin `application/json` POST triggers a failing CORS preflight (no CORS headers exist), and other content-types hit the default origin check.
- **Open redirect (SAFE):** Every dynamic redirect resolves to a server-controlled value — `/dashboard` with an `encodeURIComponent`'d MAC from the signed pending cookie (`auth/verify/+page.server.ts:54`), Maya's gateway URL / same-origin `event.url.origin` success/cancel URLs (`top-up/+page.server.ts:219`), and hardcoded internal paths for the admin flows. The recent "return to own origin" change is a same-origin echo, not a user-supplied absolute URL.
- **Cross-network IDOR (SAFE):** The model is single-operator with global `owner`/`admin` roles; networks are not scoped per-staff, so no "staff for network A reads network B" surface exists. Owner-only actions consistently call `requireOwner`, which re-reads the role from the DB.

---

## Needs Runtime / Deploy Context

#### NC-1 — Per-IP rate-limit keys are spoofable when ADDRESS_HEADER is enabled behind a proxy

- **File:** `apps/customer/src/lib/server/rateLimit.ts:14-16`
- **Category / Dimension:** Rate limiting — ratelimit-abuse-pii
- **Verdict:** needs-context (high confidence) · **Severity:** Info

**Description:** `clientIp()` derives from adapter-node `getClientAddress()`. By default (`ADDRESS_HEADER` unset) this is the real TCP peer and is safe. The `.env.example` files document that setting `ADDRESS_HEADER=x-forwarded-for` with a wrong/absent `XFF_DEPTH` makes the client IP attacker-spoofable, letting an attacker rotate the header to evade every per-IP throttle (admin login, 2fa, forgot-password, webhook flood cap, handoff). This is a deployment-configuration hazard, not a code bug — the default is safe and the risk is clearly warned.

**Impact:** If deployed behind a reverse proxy with `ADDRESS_HEADER` misconfigured, all per-IP limiters become bypassable via a forged `X-Forwarded-For` header (or collapse to one bucket → self-DoS lockout).

**Evidence:**
```
return event.getClientAddress().replace(/^::ffff:/, '');
// trusts adapter-node ADDRESS_HEADER/XFF_DEPTH env — .env.example: 'Getting XFF_DEPTH wrong ... makes the client IP SPOOFABLE'
```

**Verifier — needs-context (high confidence):** `clientIp()` returns `getClientAddress()` with only an `::ffff:` strip; adapter-node honors `ADDRESS_HEADER`/`XFF_DEPTH`, so a wrong/absent `XFF_DEPTH` makes the returned IP attacker-controlled and every per-IP limiter (including `cronIpAllowed`) spoofable. The `.env.example` warnings exist verbatim (`apps/customer/.env.example:24-31`, `apps/admin/.env.example:15-21`) and ship the safe default (both commented out/empty). Exploitability depends entirely on operator deployment config that cannot be observed from the repo. Info is appropriate — the default is safe and the risk is documented rather than latent. **Action for operators:** treat `XFF_DEPTH` as security-critical and verify it matches the actual proxy hop count before enabling `ADDRESS_HEADER`.

---

## Appendix — Refuted Findings

| Finding | File | Why refuted |
|---------|------|-------------|
| Postgres exposed on all interfaces with trivial hardcoded credentials | `compose.yaml` | Every literal fact holds (`5432:5432`, `root/mysecretpassword`, unpinned `postgres` image), but the impact/severity assume a production deployment that does not exist in the repo. `compose.yaml` has only a single `db` service named `local`; README labels it "shared Postgres for local dev," `.env` files are unshared, and there is no production compose/Dockerfile/deploy manifest. The claim that "any device on the target WiFi can log in as root and read all customer/admin data" is refuted — production operators supply their own credentials. Residual issue is a low dev-hardening nit (local DB binds `0.0.0.0`, exposing seeded/test data on an untrusted network), which does not support a medium data-breach finding. |

---

## Not in Scope / Recommended Next Steps

**No remediation was performed.** This document is a read-only audit report; no source files were modified, no configuration was changed, and no fixes were applied. All findings above are presented for the maintainers to triage and address on their own schedule.

Suggested prioritization for a follow-up remediation engagement (owner's decision — not performed here):

1. **Throttle and harden OTP verification (H-1) — highest priority.** Add an app-layer rate limit to the `verify` action (phone + MAC + IP, mirroring `enforceOtpSendLimit`) and/or make better-auth's attempt counter atomic so the concurrency race cannot bypass the 3-attempt cap. This is the only high-severity finding and the only confirmed account-takeover path.
2. **Bind the device MAC to the caller (M-1, M-2, L-1).** Resolve the caller's true device MAC server-side (portal `?mac` cookie / router IP→MAC) and reject client-supplied MACs that don't match; add cross-user collision handling so one user's unbind cannot revoke another user's shared router binding.
3. **Add per-IP/global caps to OTP sends and a throttle to the top-up checkout action (M-3, M-4).**
4. **Extend rate limiting to the dashboard grant actions and the forgot-password recipient axis (L-4, L-9).**
5. **Wire the `amount_mismatch` warning to an alert and document a refund runbook (I-1).**
6. **Harden secrets/config: enforce `BETTER_AUTH_SECRET` length/entropy, give each app a distinct secret, rotate the working-tree secrets, and treat `XFF_DEPTH` as security-critical at deploy time (L-5, L-7, NC-1).**
7. **Housekeeping: add security headers to the locator app, scrub MAC/IP from `console.*` logs, consider a `script-src` CSP baseline, confirm the map-action privilege boundary, and pin the admin cookie attributes (L-6, L-8, L-10, I-2, I-3).**

All file paths cited in this report are relative to the monorepo root and were verified against the working tree on the `system-audit` branch as of 2026-07-06.