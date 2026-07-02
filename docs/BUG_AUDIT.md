# Bug Audit — 2026-07-02

A multi-subsystem bug hunt (payments, network/sessions, auth/governance, customer portal,
admin dashboard). Findings below are **real bugs with evidence**, not style. Each carries a
severity, location, failure scenario, suggested fix, and confidence. Items marked
**✅ verified** were re-checked against the source by hand; the rest are high-signal
agent-reported findings with the stated confidence.

Legend — Severity: 🔴 High · 🟠 Medium · 🟡 Low. Status: `todo` unless noted.

---

## 🔴 High — do these first

### H1. Pending-OTP cookie is `Secure` on HTTP-LAN deploys → login is impossible ✅ verified · ✔ FIXED (2026-07-02)
- **Fix landed:** added `PENDING_COOKIE_SECURE` (ORIGIN-based) in `otp.ts`; login + verify pages now use it instead of `secure: !dev`. Typechecks clean. Portal-context cookie checked — sets no `secure` flag, so unaffected.
- **Where:** `apps/customer/src/routes/login/+page.server.ts:56` and `apps/customer/src/routes/auth/verify/+page.server.ts` (resend) — both set the `veent-portal-verify` cookie with `secure: !dev`.
- **Bug:** Session cookies pin `Secure` to the ORIGIN protocol (`useSecureCookies = ORIGIN.startsWith('https://')`, `auth.ts:18`) precisely so the portal can run over plain HTTP on a LAN — a mode `validateEnv.ts:41-47` explicitly permits (warns, doesn't fail). The pending cookie instead uses `secure: !dev`, i.e. `Secure=true` in any prod build. Browsers won't send (or store) a `Secure` cookie over `http://`.
- **Failure:** On an HTTP LAN appliance: `login` sets the pending cookie → redirect to `/auth/verify` → cookie absent → `load` bounces back to `/login`. **Guests can never complete OTP login.** This is the deployment mode this whole project targets.
- **Fix:** Use `secure: useSecureCookies` (or `event.url.protocol === 'https:'`) in both files, matching the session cookies.
- **Confidence:** High. **Effort:** trivial (2 one-line changes).

### H2. Free-time eligibility is consumed even when the grant fails ✅ verified · ✔ FIXED (2026-07-02)
- **Fix landed:** `startFreeAccessAndBindDevice` now runs the cooldown claim + bind + router grant in ONE transaction (mirrors `startPaidAccessAndBindDevice`); a failed grant rolls the `last_free_session_at` stamp back. Added 3 free-path atomicity tests to `grant-atomic.spec.ts` (34 pass). Typechecks clean.
- **Where:** `packages/core/src/services/sessions.ts:623-671` (`startFreeAccessAndBindDevice`). (Found independently by two auditors.)
- **Bug:** The cooldown claim (`UPDATE … SET last_free_session_at = now`) commits in its **own** transaction (623-659). The router grant runs afterward in a **separate** transaction via `extendAccessAndBindDevice` (665). A grant failure rolls back only the second tx; the cooldown stamp is already committed.
- **Failure:** Router hiccup/timeout → guest gets **no internet** but **loses free-time eligibility for the full 12h cooldown**. Retrying doesn't help. The paid path deliberately folds spend+grant into one tx to avoid exactly this; the free path doesn't.
- **Fix:** Fold the conditional `last_free_session_at` claim into the same transaction as the bind+grant (mirror `startPaidAccessAndBindDevice`), so a failed grant rolls the claim back.
- **Confidence:** High. **Effort:** moderate.

### H3. Revoke cron clobbers a freshly-paid access window ✅ verified · ✔ FIXED (2026-07-02)
- **Fix landed:** `expireDueAccounts` now re-checks each account under a `FOR UPDATE` lock and skips it if the window was extended or paused since the snapshot; expire + null-window happen in that locked tx, router revokes run after commit (so a slow router never holds the lock). Typechecks clean.
- **Where:** `packages/core/src/services/sessions.ts:679-731` (`expireDueAccounts`).
- **Bug:** Selects due accounts (`accessExpiresAt <= now`) into a snapshot, then loops doing per-account router revokes (seconds of round-trips). The final `UPDATE … SET accessExpiresAt = null` (727-730) has **no `lte(accessExpiresAt, now)` guard and no `FOR UPDATE` re-check**, and the per-MAC revoke revokes every active row regardless of its own `expiresAt`.
- **Failure:** A user in the due snapshot buys a tier mid-pass. `startPaidAccessAndBindDevice` extends the window (under its own `FOR UPDATE` lock) and grants. The cron, on its stale snapshot outside that lock, then revokes the just-granted MAC and nulls the window. **User is charged, gets access, then is cut off** — violates Business Rule #1. Same hazard for a free-time re-claim. (The in-loop session re-query even picks up the *new* session row, so the clobber is reliable, not just a narrow race.)
- **Fix:** Process each account in a transaction that re-reads the profile `FOR UPDATE` and skips if `accessExpiresAt > now || accessPausedAt != null`; only then revoke + null. At minimum, gate the null-update with `and(lte(accessExpiresAt, now), isNull(accessPausedAt))` and skip revoking rows whose `expiresAt > now`.
- **Confidence:** Medium-high. **Effort:** moderate.

---

## 🟠 Medium

### M1. App login / 2FA / forgot-password throttles are bypassable via direct better-auth endpoints
- **Where:** `apps/admin/src/routes/login/+page.server.ts:21`, `login/2fa/+page.server.ts:23`, `forgot-password/+page.server.ts:15`; root cause `hooks.server.ts:73`.
- **Bug:** The DB-backed per-IP throttles live only inside the page form actions. The equivalent better-auth endpoints (`/api/auth/sign-in/email`, `/api/auth/two-factor/verify-totp`, `/api/auth/two-factor/verify-backup-code`, `/api/auth/request-password-reset`, `/api/auth/reset-password`) are reachable directly and governed only by better-auth's built-in limiter — generic 100/10s for reset, and **disabled entirely unless `NODE_ENV==='production'`** (in-memory, per-process).
- **Failure:** Reset-email mail-bombing / enumeration probing of any staff address at up to 600/min; if the deploy's `NODE_ENV` isn't exactly `production`, sign-in and TOTP verify have **zero** throttle on the direct endpoints.
- **Fix:** Configure better-auth `rateLimit` explicitly (enable regardless of env, `customRules` for reset + two-factor, DB-backed store), or front all of `/api/auth/*` with a limiter in `hooks.server.ts`.
- **Confidence:** High (mechanism), Medium (impact depends on deploy `NODE_ENV`).

### M2. Promote / owner-change TOTP step-up is rate-limited per-IP (defeated by IP rotation)
- **Where:** `apps/admin/src/routes/(app)/staff/+page.server.ts:67` and `:302` — key on `clientIp(event)`; contrast `$lib/server/step-up.ts:27` which correctly keys on `user.id`.
- **Bug:** `auth.api.verifyTOTP()` runs in-process, so better-auth's `/two-factor/*` HTTP limit never applies to step-up; the app's per-IP 5/15min counter is the only gate, and rotating source IPs resets it.
- **Failure:** An attacker with a hijacked active-owner session can brute-force the 6-digit step-up (promote a controlled admin → owner, or demote a co-owner) — the exact escalation step-up exists to stop. The sibling `/content` step-up already keys on user id.
- **Fix:** Key `admin_promote_step_up` and `admin_owner_change_step_up` on `event.locals.user.id`.
- **Confidence:** Medium (requires pre-existing owner-session compromise).

### M3. Staff-email enumeration via forgot-password response timing
- **Where:** `apps/admin/src/routes/forgot-password/+page.server.ts:28` → `auth.ts:53-75`.
- **Bug:** The action returns a generic `{ sent: true }` (good), but **awaits** `mailer.send()` for existing users while a non-existent email skips it — a measurable latency oracle.
- **Fix:** Fire the mail send without blocking the response (queue / `void`), or pad both branches to constant time.
- **Confidence:** Medium-high.

### M4. `setInterface` action has no owner authorization ✅ verified · ✔ FIXED (2026-07-02)
- **Fix landed:** added `requireOwner` gate to the `setInterface` action, matching its siblings. Typechecks clean. (Action is dead in the UI — superseded by `setApConfig` — but gated rather than deleted to stay low-risk.)
- **Where:** `apps/admin/src/routes/(app)/networks/+page.server.ts` — `setInterface` action.
- **Bug:** Writes `network_health.interface_name` with no `requireOwner`, unlike sibling `setApConfig`/`deleteNetwork`/`wipe`. The `(app)` layout guards only auth + 2FA, not role. It's a leftover path (the UI now uses `setApConfig`).
- **Failure:** Any non-owner admin can POST `/networks?/setInterface` to rebind/clear any AP's interface, corrupting per-AP user attribution and the bandwidth-queue target.
- **Fix:** Add `requireOwner` at the top of the action, or delete the now-unused action.
- **Confidence:** High (guard absent). **Effort:** trivial.

### M5. Out-of-order Maya events regress a settled SUCCESS to FAILED in Finance
- **Where:** `packages/core/src/services/reconcilePayments.ts:91,98-103` (`recordPaymentTransaction`).
- **Bug:** The upsert / reference-no collapse writes whatever event arrives last, with no status precedence. One checkout can produce a FAILED attempt then a SUCCESS under different payment ids but the same `reference_no`; if SUCCESS is processed first, the later FAILED overwrites it to `PAYMENT_FAILED`.
- **Failure:** Finance "Gross Revenue (settled)" (filters `PAYMENT_SUCCESS`) silently under-counts. Crediting is unaffected (guarded by the checkout claim).
- **Fix:** Make the update status-aware — never regress a terminal `PAYMENT_SUCCESS`.
- **Confidence:** Medium.

### M6. Misconfigured bundle (null/0 `creditsProvided`) makes the webhook throw forever
- **Where:** `reconcilePayments.ts:190-209`, `credits.ts:110`, webhook call `payment/+server.ts:152` (un-guarded await).
- **Bug:** Credit amount is `pkg.credits ?? 0`; if null/0, `addCreditsTx` throws `amount must be positive`, rejecting the settle transaction → checkout stays `pending`. Maya redelivers; every retry (and the reconcile cron) re-throws.
- **Failure:** Money charged, checkout never settles, credit never lands, **cannot self-heal**. Requires a misconfigured/edited bundle, but there's no guard.
- **Fix:** Treat null/≤0 configured credit as a recorded-but-not-credited terminal outcome (like `amount_mismatch`) — settle + flag for an operator instead of throwing.
- **Confidence:** High (mechanism); trigger is a config error.

### M7. Transient Maya re-fetch failure is returned to the gateway as HTTP 400
- **Where:** `apps/customer/src/routes/api/webhooks/payment/+server.ts:51-62`; thrown by `maya.ts:256-259,73-75`.
- **Bug:** `verifyWebhook` throws for both a spoofed body **and** an upstream re-fetch failure (Maya 5xx/timeout); the handler maps every throw to `400`. Gateways treat 4xx as permanent → no redelivery.
- **Failure:** A legit paid webhook landing during a Maya blip is acked-as-rejected; crediting then depends solely on the reconcile cron (delayed, and only if the pending row was written).
- **Fix:** Type/tag transient upstream failures and return 5xx (retryable); reserve 400 for genuinely malformed/spoofed bodies.
- **Confidence:** Medium.

### M8. `listUsers` full-table-scans `network_sessions` on every live frame
- **Where:** `apps/admin/src/lib/server/queries.ts:75-85` (part of `dashboardSnapshot`, re-queried per DB notify).
- **Bug:** No `WHERE`, no `LIMIT` — pulls all session history ordered by `startedAt desc` just to derive last-MAC-per-user + active devices.
- **Failure:** Every SSE notify triggers a full scan of an ever-growing table across the Dashboard/Users/Networks live feed; degrades linearly.
- **Fix:** Bounded active-sessions query (`WHERE status = active`) for devices + `DISTINCT ON (user_id) … ORDER BY user_id, started_at DESC` for last MAC.
- **Confidence:** High (perf/scalability, not correctness).

### M9. Finance CSV export loses centavo precision and embeds currency formatting
- **Where:** `queries.ts:670-671` (`amount: peso(Number(r.amount))`) → `finance/export/+server.ts:30`.
- **Bug:** `amount` is `numeric(12,2)` but exported through `peso()` = `₱${Math.round(n).toLocaleString()}` — e.g. `₱1,235` instead of `1234.50`.
- **Failure:** The reconciliation CSV can't be summed in a spreadsheet and won't tie out to Maya's centavo figures.
- **Fix:** Export the raw numeric `amount`; keep `peso()` for the on-screen table only.
- **Confidence:** High. **Effort:** small.

### M10. `reconcileGuestBindings` can revoke a binding a concurrent grant just created
- **Where:** `sessions.ts:741-769`, interacting with `bindMacToAccount` grant-inside-tx (`sessions.ts:237-243`).
- **Bug:** `network.grant` writes the router binding **inside** the DB tx (router applies it immediately, before commit). Reconcile reads router bindings first, then DB active rows; a pass falling in the `[router-write, DB-commit]` window sees "binding with no backing row" and revokes it.
- **Failure:** Active DB session with **no internet**; doesn't self-heal (reconcile only removes) until the user reloads and auto-bind re-grants.
- **Fix:** Read the DB active set *before* the router binding list, or ignore bindings younger than N seconds.
- **Confidence:** Medium (narrow window).

---

## 🟡 Low

### L1. `openHostAccessForDevice` scopes checkout access to a possibly-stale/reused IP *(new code, this branch)* · ✔ FIXED (2026-07-02)
- **Fix landed:** added `currentHotspotIpForMac` — resolves the device IP from the **hotspot host table only** (currently-connected clients), replacing the `ipsForMac` lease/ARP union in `openHostAccessForDevice`. A stale MAC whose device has left now yields no host row → `null` → nothing opened, so access can't be scoped to a reused IP. Works on NAT hotspots (uses the router's live client view, not the app's IP→MAC). The checkout MAC is already live-preferred (`resolveMacForUser`), so attribution is unaffected. Core typechecks clean; 34 tests pass.
- **Where:** `packages/core/src/integrations/network/mikrotik.ts` (`ipsForMac` picks `ips[0]`), fed a stale MAC from `network-location.ts:74-87` (`resolveMacForUser` durable fallback).
- **Bug:** The checkout flow may pass the account's durable last-known MAC (an old device); `ipsForMac` blindly takes `ips[0]`, then opens `www.google.com` (an Android captive-probe host) `src-address=<that IP>`. If DHCP reassigned that IP to another guest on the sign-in screen, that guest's `/generate_204` probe now succeeds pre-auth — **reintroducing the exact flash this feature removes**, for the wrong device. Bounded by the 15-min sweep TTL; only 3 hosts, so not a full bypass.
- **Fix:** Only open access when the MAC was resolved **live** this request (portal cookie / IP→MAC), not the durable fallback; prefer the freshest IP source (DHCP lease / recent ARP) over `ips[0]`.
- **Confidence:** Medium. *(Worth tightening before the on-router test.)*

### L2. `/api/network/grant` grants/free-claims for an arbitrary MAC not bound to the caller
- **Where:** `apps/customer/src/routes/api/network/grant/+server.ts:42-59`. Validates MAC *shape* only.
- **Bug:** An authenticated user can spend their own credits / free-time to bypass an arbitrary MAC. Self-limited (own credits, own cooldown), so low impact, but a real authz gap.
- **Fix:** Cross-check the submitted MAC against the caller's resolved device MAC, or drop the client-supplied MAC for server-resolved identity.
- **Confidence:** High (behavior), Low (impact).

### L3. SSE per-user stream counter can leak → eventual 429 lockout
- **Where:** `apps/customer/src/routes/api/account/stream/+server.ts:33-99`.
- **Bug:** `openStreams` is incremented at `:36` but `release()` is wired only in the `abort` listener registered at `:89`. If the signal is already aborted (fast connect/disconnect) or anything earlier in `start()` throws (e.g. LISTEN client fails), `release()` never runs.
- **Failure:** Each leak permanently consumes one of `MAX_STREAMS_PER_USER = 4`; enough leaks → `429` on every dashboard load until process restart (in-memory map).
- **Fix:** Check `signal.aborted` up front and `release()` immediately; ensure `release()` also runs if `start()` throws.
- **Confidence:** Medium.

### L4. `grant` idempotency check only inspects the first binding row for a MAC
- **Where:** `mikrotik.ts:290-303`. Reads `?mac-address=` but only examines `rows[0]`.
- **Bug:** RouterOS permits multiple ip-bindings per MAC. If an admin (`veent-admin`) bypass and a guest (`veent-portal`) binding coexist and `rows[0]` isn't the intended one, `grant` `/set`s the wrong row — can convert an admin bypass into a guest-tagged (sweepable) binding.
- **Fix:** Iterate all matching rows; reconcile to one canonical binding keyed by expected comment.
- **Confidence:** Medium.

### L5. Password reset does not revoke existing sessions
- **Where:** `apps/admin/src/lib/server/auth.ts:35-99` — `revokeSessionsOnPasswordReset` unset.
- **Bug:** A completed reset leaves prior sessions valid; a stolen cookie survives the victim's password reset (hooks re-check status/role, never credentials). Inconsistent with owner-change, which deletes the target's sessions.
- **Fix:** Set `emailAndPassword.revokeSessionsOnPasswordReset: true`.
- **Confidence:** High (behavior), Low (needs prior cookie theft).

### L6. No app rate-limit on the reset-password token-consumption action
- **Where:** `apps/admin/src/routes/reset-password/+page.server.ts:13-39`. Only better-auth's generic 100/10s (none in dev).
- **Fix:** Add a per-IP `rateLimit('admin_reset_ip', …)` mirroring forgot-password.
- **Confidence:** High (gap), Low (token entropy mitigates).

### L7. Credited quantity read at settle-time, not frozen at checkout
- **Where:** `reconcilePayments.ts:190-194` reads current `packages.creditsProvided`.
- **Bug:** An admin editing a bundle's `creditsProvided` (without changing `fiatCost`) between checkout and settlement changes what the buyer receives; the amount-integrity check only compares fiat.
- **Fix:** Snapshot `creditsProvided` onto `payment_checkouts` at creation; credit from the snapshot.
- **Confidence:** High.

### L8. A non-paid gateway read can lock out a later genuine paid webhook
- **Where:** `reconcilePayments.ts:275-278,353-354` (`markUnpaid`) vs the claim's `status='pending'` requirement (`:161`).
- **Bug:** If a poll reads the checkout as failed/expired first, `markUnpaid` flips it out of `pending`; a later paid webhook can't win the claim → not credited. Relies on the gateway never reporting a non-paid terminal state before a paid one.
- **Fix:** Only close on gateway-guaranteed-terminal states, or let a later authoritative `paid` override.
- **Confidence:** Medium.

### L9. Reconcile idempotency / Finance id can be an earlier FAILED attempt
- **Where:** `maya.ts:309` — `c.payments?.[0]?.id ?? c.id ?? checkoutId`.
- **Bug:** `payments[0]` may be an earlier FAILED payment while `status` is `paid`, so the Finance row id / `external_transaction_id` references a non-authoritative payment. Traceability only (claim still prevents double-credit); can also feed M5.
- **Fix:** Select the paid/most-recent payment from the array.
- **Confidence:** Medium.

### L10. Timezone mismatch between period range and SQL `date_trunc` bucketing
- **Where:** `apps/admin/src/lib/server/period.ts:16-18` (`setHours` in Node local TZ) vs `queries.ts:544` (`date_trunc` in DB session TZ).
- **Bug:** If app TZ ≠ Postgres session TZ (e.g. app Asia/Manila, DB UTC), range boundaries and day/week buckets misalign; first/last buckets become partial and near-midnight revenue lands on the wrong day.
- **Fix:** Standardize on one business TZ (`date_trunc(… AT TIME ZONE 'Asia/Manila')` + compute `from` in the same TZ, or set the pool timezone).
- **Confidence:** Medium (depends on deployed DB TZ).

### L11. CSV export silently truncates at 10,000 rows
- **Where:** `finance/export/+server.ts:21` (`pageSize: 10_000`).
- **Bug:** Over `all`/high-volume periods the export drops the oldest rows beyond 10k with no notice, while the UI invites exporting "the full CSV."
- **Fix:** Paginate/stream the full set, or warn when `total > 10_000`.
- **Confidence:** High (behavior), Medium (severity depends on volume).

---

## Checked and clean (no action)
Double-credit serialization (atomic checkout claim + unique `external_transaction_id`);
webhook replay; signature/verification (re-fetch-with-secret model); minor-unit rounding;
2FA half-login (no access before verify); never-zero-owners guard (advisory-lock + in-txn
re-check); unanimity vs live owner set; reset-token single-use + 24h expiry; OTP
rate-limit keying; settings cache (degrades safe to defaults); device-cap race (`FOR UPDATE`);
CSV formula-injection guard; content-CMS owner+step-up gating; bandwidth Kbps/`null`=uncapped
mapping; finance join fan-out; `sweepHostAccess` timestamp parsing + src-address/NAT layer.
