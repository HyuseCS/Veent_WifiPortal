# Security Risk Register — Veent WiFi Portal

> Living list of known security risks, their status, and who owns them. Keep it
> current: when you fix one, flip its status and note the commit/PR. Deep
> rationale for the architectural items lives in [`ARCHITECTURE_REVIEW.md`](./ARCHITECTURE_REVIEW.md).
>
> Last updated: 2026-06-29

## Status at a glance

| # | Risk | Severity | Status | Owner |
|---|------|----------|--------|-------|
| R1 | OTP send had no rate limit (SMS-bomb / credit drain) | High | ✅ Resolved | — |
| R2 | `rate_limits` table built but never wired in | High | ✅ Resolved | — |
| R3 | `emailAndPassword` enabled on a phone-only portal + guessable temp email | Medium | ✅ Resolved | — |
| R4 | `/api/network/grant` spend→grant is not transactional | Medium | ✅ Resolved | — |
| R5 | Maya webhook signature scheme is an unconfirmed assumption | Medium | ✅ Resolved (moot by design) | — |
| R6 | `/register` admin hole mints an active owner per submit | High (dev-only) | ✅ Resolved (deleted) | — |
| R7 | No rate limit on login/register, webhook, cron, SSE, Finance export | Low–Med | ✅ Resolved | — |
| R8 | No config fail-fast for `CRON_SECRET` / payment keys / `DATABASE_URL` | Low | ✅ Resolved | — |
| R9 | Router management plane (Winbox/Dude/API) reachable from the internet | High | 🟡 Mitigated | — |
| R10 | Portal↔router API runs in cleartext (port 8728, no TLS) | Medium | ✅ Resolved | — |
| R11 | node-routeros connection timeout crashes the whole app server | Medium | ✅ Resolved | — |
| R12 | Client-supplied device MAC trusted on grant paths (free internet for arbitrary devices / cross-user revoke DoS) | High | 🔴 Accepted (deferred) | — |
| R13 | Admin bulk customer-delete not owner-gated (bypasses the owner-only verified wipe) | High | ✅ Resolved | — |
| R14 | `consumeRateLimit` TOCTOU race + no unique constraint (burst-bypassable throttles) | High | ✅ Resolved | — |
| R15 | Admin `/api/auth/sign-up/email` open (no `disableSignUp`) | Medium | ✅ Resolved | — |
| R16 | Mandatory admin 2FA gate missing on `/api/connected` + `/api/router-log` | Medium | ✅ Resolved | — |
| R17 | CSV formula injection in Finance export | Medium | ✅ Resolved | — |
| R18 | `payment_transactions` double-count (webhook vs poll record under divergent ids) | Medium | ✅ Resolved | — |
| R19 | OTP-send throttle bypassable via direct `/api/auth/phone-number/send-otp` | High | ✅ Resolved | — |
| R20 | Low-severity hardening: no security headers, webhook error reflection, MAC case-drift, proxy-IP trust undocumented | Low | ✅ Resolved | — |

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

## R3 — Email auth on a phone-only portal ✅ Resolved

**Was:** `auth.ts` had `emailAndPassword: { enabled: true }`, activating
`/sign-up/email` + `/sign-in/email` (which the phone-only portal never uses).
Combined with `signUpOnVerification`'s **predictable** temp email
`<phone>@otp.veent.local`, an attacker could pre-create `<phone>@otp.veent.local`
with a password before the real owner's first SMS login — an account
collision/takeover surface.

**Fix (2026-06-24):** in `apps/customer/src/lib/server/auth.ts` —
`emailAndPassword: { enabled: false }` (closes both endpoints; phone OTP is the only
credential provider), and `getTempEmail` now returns a **random** `randomUUID()`
`@phone.veent.local` address so it can't be derived from the phone even if email
auth ever returns. Stale `/sign-up/email` + `/sign-in/email` entries removed from the
customer `docs` route. Verified phone-only auth paths unaffected (svelte-check clean).

**Cleanup note:** two pre-existing **test** credential accounts
(`butaya.kentvincent07@gmail.com`, `t@t.com`) were found from when the surface was
open — neither is a malicious `@…veent.local` pre-registration. They can no longer
sign in (email auth off) and can be deleted at will.

---

## R4 — Grant path is not transactional ✅ Resolved (2026-06-24)

**Was:** in `grant/+server.ts`, `spendCredits` and `startSession` were two separate
awaits. If `startSession` (or the firewall drop) failed after credits were deducted,
the user paid and got nothing.

**Fix:** `startPaidSession` (`packages/core/src/services/sessions.ts`) wraps spend +
session-open + router grant in **one `db.transaction`**; a failed grant throws and
rolls back the spend (no charge stands). Wired into `/api/network/grant` and the
dashboard buy-tier action, both with try/catch → 502/503 "credits were not charged".
Covered by `apps/customer/src/lib/server/grant-atomic.spec.ts`.

## R5 — Maya webhook signature assumption ✅ Resolved (moot by design)

The HMAC assumption is gone. `verifyWebhook` (`maya.ts`) does **no** signature check:
Maya Checkout webhooks are unsigned, so it takes only the payment id from the
(untrusted) body and **re-fetches the authoritative payment from Maya's API with the
secret key**, trusting that response. A spoofed body can't produce a real paid payment
under our account. Covered by `maya-webhook.spec.ts`. Residual hardening (the per-IP
flood cap on the webhook endpoint) landed under R7.

## R6 — `/register` admin hole ✅ Resolved (deleted 2026-06-24)

`apps/admin/src/routes/register/` was **deleted** along with the `<!-- TEMP: remove
with /register -->` link in `login/+page.svelte`. Owners are now created only via
`bun run --filter radius-admin bootstrap:owner`; all other staff via the owner-only
`/staff` invite flow.

## R7 — Remaining unthrottled endpoints ✅ Resolved (2026-06-24)

A shared `rateLimit(scope, identifier, max, windowMs)` helper
(`apps/{customer,admin}/src/lib/server/rateLimit.ts`, over the `rate_limits` table with
additive `scope`/`identifier` columns — migration `0014`) was wired into:
- **Admin login** — per IP (10 / 15 min). *(Customer auth is OTP — teammate-owned.)*
- **`/api/network/grant`** — per user (20 / hr).
- **Finance CSV export** — per admin (20 / hr).
- **Payment webhook** — per-IP flood cap (120 / min).
- **SSE `/api/connected`** — concurrent-stream cap per user (6, in-memory).
- **Admin email sends** (staff invite + wipe code) — `checkAdminEmailLimit`, per
  recipient (5 / hr) and per actor (20 / hr).
- **Crons** (`/api/network/revoke`, `/api/payments/reconcile`) — optional
  `CRON_IP_ALLOWLIST` source-IP gate on top of `x-cron-secret`.

Logic covered by `apps/customer/src/lib/server/rateLimit.spec.ts`. The `/register`
form action item is moot — the route was deleted (R6).

## R8 — Config fail-fast ✅ Resolved (2026-06-24)

`validateEnv()` (`apps/{customer,admin}/src/lib/server/validateEnv.ts`) is called at the
top of each app's `hooks.server.ts`. It **hard-fails in production** on any missing
required var (customer: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `CRON_SECRET`,
`MAYA_PUBLIC_KEY`, `MAYA_SECRET_KEY`, + `MIKROTIK_*` when `NETWORK_CONTROLLER=mikrotik`;
admin: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `ORIGIN`, + mikrotik conditional), **warns
in dev**, and **no-ops during build**. So a misconfigured deploy dies at boot, not on
first request.

## R9 — Router management plane exposed to the internet 🟡 Mitigated

**Mitigated 2026-06-24:** the RouterOS API service's *Available From* is now
restricted to the admin server, and management services are no longer open to the
WAN scanners. Remaining surface-reduction items (firewall input chain, MAC-server
lockdown, disabling unused services) are tracked in the checklist below as
ongoing. The cleartext-API concern was split out into **R10**.

<details><summary>Original finding + full hardening checklist</summary>


The MikroTik router logs a constant stream of denied probes to its management
services from foreign internet scanners:

```
warning denied winbox/dude connect from 91.196.152.214
warning denied winbox/dude connect from 66.132.172.128
warning denied winbox/dude connect from 146.88.240.23
```

These are **automated bots** sweeping the internet for exposed MikroTik routers,
not targeted attacks. The router is *currently* denying them, but the fact that
they reach far enough to be logged means the management ports are reachable from
the WAN. MikroTik is a high-value target because of mass-exploited bugs
(CVE-2018-14847 Winbox auth bypass → VPNFilter / Mēris botnets).

**Why it matters for this app:** the admin dashboard drives this exact router to
grant/revoke guest WiFi — `createMikrotikController`
(`packages/core/src/integrations/network/mikrotik.ts`) connects over the RouterOS
**binary API** (port **8728** plain / **8729** api-ssl). A compromised router =
the portal's entire access-control plane is owned **and** the guest LAN is
exposed. This is the access-control trust boundary, so it ranks High.

> ⚠️ **Do NOT disable the `api`/`api-ssl` service** — that's the channel the admin
> app uses. Restrict *who* can reach it instead (Available From = the admin
> server's IP, ideally over a VPN), and prefer api-ssl (TLS) so the API
> credentials aren't sent in cleartext.

**Hardening checklist (for the network owner — apply in MikroTik Safe Mode to
avoid locking yourself out):**

1. **Restrict management services** — `IP → Services`: set `winbox`, `ssh`,
   `www`/`www-ssl` Available From = LAN/VPN only; set `api`/`api-ssl` Available
   From = the admin server's IP **only** (don't disable it).
2. **Firewall the `input` chain** — accept established/related + management from
   trusted sources, drop invalid, then drop everything else from WAN on the
   management ports (`8291` winbox, `8728/8729` API, `22` ssh, `23` telnet, `80`
   www, `53` DNS, `161` SNMP).
3. **Disable unused services** — telnet, ftp, www (http), the Dude server, api-ssl
   if TLS isn't used yet, SNMP if unused (`IP → Services`, `/tool/...`).
4. **Lock down the layer-2 backdoor** — restrict MAC-server (`mac-telnet`,
   `mac-winbox`, `mac-ping`) to the management interface only; an attacker on the
   guest L2 segment can otherwise reach Winbox without an IP.
5. **Turn off discovery/extras on WAN** — neighbor discovery (MNDP/LLDP/CDP),
   bandwidth-test server, RoMON, UPnP, SOCKS/web-proxy, and IP-Cloud/DDNS if
   unused (each is reachable surface or an amplification/abuse vector).
6. **DNS** — disable `allow-remote-requests` toward the WAN (open-resolver abuse)
   or firewall UDP+TCP `53` from WAN.
7. **Use TLS for the portal's API link** — set the controller to `tls=true`
   (port 8729) so `MIKROTIK_USER`/`MIKROTIK_PASSWORD` aren't sent in plaintext.
8. **Accounts** — strong admin password; a dedicated least-privilege API user with
   per-user `allowed-address` = admin server IP; remove/disable the default
   `admin` user.
9. **Auto-blacklist scanners/brute-force** — firewall rules that detect repeated
   connections to management ports and drop the source for a timeout (also quiets
   these logs).
10. **Keep RouterOS + RouterBoard firmware updated** — the real fix for the known
    exploits — and ship router logs to a remote syslog for audit.
11. **Ideal end state:** no management plane on the public internet at all — reach
    the router only over WireGuard/VPN.

</details>

---

## R10 — Portal↔router API is cleartext ✅ Resolved

**Resolved 2026-06-24.** The portal↔router API now runs over **api-ssl (TLS, 8729)**.

Setup that landed:
- Router: signed a self-signed cert (`api-cert-radius`, `key-usage=tls-server,key-cert-sign`)
  and enabled `api-ssl` on 8729 with *Available From* restricted to the apps' host
  `10.0.0.147/32`.
- Apps: both `apps/customer/.env` and `apps/admin/.env` set to `MIKROTIK_PORT=8729`,
  `MIKROTIK_TLS=true`, `MIKROTIK_TLS_INSECURE=true` (self-signed cert).
- Verified: customer grant brings a device online and the admin Networks page loads
  health — both over TLS, no crash (the **R11** fix held).
- Final step: cleartext `api` (8728) disabled on the router
  (`/ip service set api disabled=yes`).

The API user's password no longer crosses the wire in cleartext, closing the
shared-segment sniff/MITM exposure.

**Reminder:** the cert was created with `days-valid=3650` — it will expire in ~10
years; no rotation needed soon, but note it exists. Pin `10.0.0.147` to a static
DHCP lease so the *Available From* restriction can't break on a lease change.

**Diagnosed 2026-06-25 — "api-ssl hangs" was the Available From restriction, not a
code/cert bug.** When the apps' host drifts off `10.0.0.147` (DHCP lease change),
api-ssl (8729) silently drops the SYN → node-routeros connect hangs to its timeout,
so the Networks page shows no health and latency stays `—`. Plain `api` (8728) kept
working because it was never actually disabled (see the "final step" above — it
wasn't applied). Verified directly: from `10.0.0.147`, api-ssl connects in ~120–200ms
and `/ping` works; raw `openssl s_client` and Node `tls.connect` both handshake in
~115ms, proving the cert/TLS path is fine. **Action items:** (1) pin the static DHCP
lease for the apps' host (the durable fix), and (2) actually disable plain `api` 8728
on the router, since it's still live and undercuts this control.

## R11 — A router connection timeout crashes the app server ✅ Resolved

**Was:** `createMikrotikController` (`packages/core/src/integrations/network/mikrotik.ts`)
opened a node-routeros connection per call with no `error` handler. On a timeout,
node-routeros re-emits `'error'` on the connection (RouterOSAPI.js:106); with no
listener Node throws "Unhandled error event" → **uncaught exception, whole app
server down** (admin exited code 1 on `SOCKTMOUT`). Far more likely over api-ssl,
which is why it surfaced during the R10 attempt — but any slow/unreachable router
could trigger it.

**Fix (2026-06-24):** in both `withConn` and `openConn` — attach a no-op `error`
listener (`conn.on('error', …)`) so the re-emit can't crash the process while the
awaited `connect()`/`write()` still reject for the caller to handle; set an explicit
`timeout: 15` (node-routeros default is 10s); and wrap `conn.close()` so teardown on
a half-dead socket can't throw. Verified against the node-routeros 1.6.9 source +
core typecheck. A router hiccup now degrades a single request instead of taking the
server down.

> Runtime-confirmed 2026-06-24: with the apps on api-ssl, the admin Networks page
> (the path that previously crashed on `SOCKTMOUT`) now loads without taking the
> server down. The fix held over the slower TLS link — which is what unblocked R10.


**Both** the customer app (guest grant/revoke) and the admin app (management) reach
the router over the **plain RouterOS API** (`MIKROTIK_HOST=10.0.0.1`,
`MIKROTIK_PORT=8728`, `MIKROTIK_TLS=false`, user `veent-portal`), so that API user's
password crosses the wire **unencrypted**. Because guests are on the **same
`10.0.0.0/24`** as the router (per DHCP leases), a guest on that L2 segment could
sniff/MITM the API credentials.

Both apps run on the same host (`10.0.0.147`), so the API *Available From*
restriction is a single `10.0.0.147/32` — but that host is DHCP-assigned, so pin it
to a static lease or the restriction will eventually break both apps' grants.

**Status:** deferred by decision on 2026-06-24 — not urgent because API access is
already restricted via *Available From* (R9), but it should be closed before
production / before guests and management share a segment long-term.

**TODO — switch the API link to api-ssl (TLS):**
1. On the router, create a self-signed cert (the `key-cert-sign` usage is required
   so it can self-sign — a `tls-server`-only cert fails with "CA not found"):
   ```
   /certificate add name=api-cert-radius common-name=10.0.0.1 \
     key-usage=tls-server,key-cert-sign days-valid=3650
   /certificate sign api-cert-radius          # async — confirm with: /certificate print detail
   /ip service set api-ssl certificate=api-cert-radius address=<ADMIN_SERVER_LAN_IP>/32 disabled=no
   ```
2. Set the same in **both** `apps/admin/.env` **and** `apps/customer/.env`
   (both apps connect): `MIKROTIK_PORT="8729"`, `MIKROTIK_TLS="true"`,
   `MIKROTIK_TLS_INSECURE="true"` (self-signed).
3. Restart both apps, verify a guest grant/revoke (customer) and a management
   action (admin) work, **then** `/ip service set api disabled=yes`.

**Stronger structural option:** move guests to their own VLAN/subnet with hotspot
client isolation, so they can't reach or sniff the management segment at all.

---

# Security audit 2026-06-29 (R12–R19)

A whole-app, security-critical-paths audit (auth/TOTP, payments, network grant, admin
authz, injection, secrets/rate-limiting). R13–R19 are fixed; **R12 is a knowingly-accepted
risk** — recorded here rather than silently dropped.

## R12 — Client-supplied device MAC trusted on grant paths 🔴 Accepted (deferred)

**Risk (High):** the grant paths take the device MAC from the request and only validate its
*shape*, never that it belongs to the caller's device:
- `apps/customer/src/routes/api/network/grant/+server.ts:39` — `isValidMac(body.macAddress)`
  is a format check only; the value flows straight into bind+grant.
- `apps/customer/src/routes/dashboard/+page.server.ts:107,131,172` — the actions **prefer the
  client form `mac`** over the server-resolved one (`resolveMac`).

Two attacks: **(1) free internet for arbitrary devices** — an authenticated user binds any MAC
they choose (e.g. a sniffed nearby device) under their own free-time/paid window; **(2)
cross-user DoS** — bind a paying victim's MAC under the attacker's account, then `unbindDevice`
revokes the *shared* router bypass and flaps the victim offline. Bounded: attack 1 spends the
attacker's own credits/free-time and is capped by the device limit + phone-OTP-gated signup;
attack 2 self-heals on the ~60s dashboard auto-rebind.

**Why accepted (2026-06-29):** the MAC-from-client is partly inherent to captive portals — the
redirect carries `?mac=` precisely because server-side IP→MAC resolution (`resolveMac`,
`network-location.ts`) is documented-unreliable (CNA cookie-jar, IP→MAC gaps, returns null on
stub/dev). A correct fix must enforce a match **only** when the router IP→MAC lookup gives a
high-confidence result and fall back to the client value otherwise, applied consistently across
the grant endpoint + 3 dashboard actions — so it's its own careful pass, and its strength is
bounded by detection reliability anyway. The **remove-device** control does *not* mitigate this
(the rogue binding lives under the *attacker's* account, invisible to the victim).

**Deferred fix:** shared resolve-and-compare helper, gated strictly on `resolveDeviceMac`
(router IP→MAC), `403` on mismatch, null/dev paths unchanged. See the audit discussion.

## R13 — Admin bulk customer-delete not owner-gated ✅ Resolved

**Was:** the `delete` action (`apps/admin/src/routes/(app)/users/+page.server.ts`) hard-deleted
selected customers (cascading all domain + auth rows) with **no `requireOwner`, no confirmation,
no step-up** — while the sibling `wipe` was owner-gated + email-code. Any non-owner admin could
select every row and POST `?/delete`, achieving the same irreversible destruction the owner-only
wipe was built to control; the bulk UI bar wasn't even hidden from non-owners.

**Fix:** `delete` now calls `requireOwner` (re-reads role from the DB); the bulk-delete bar in
`UsersTable.svelte` is gated behind `isOwner` (defense-in-depth). Commit `cc420c2`.

## R14 — Rate-limit TOCTOU race + no unique constraint ✅ Resolved

**Was:** `consumeRateLimit` (`packages/core/src/services/rateLimit.ts`) did `SELECT` then a
separate `INSERT`/`UPDATE` with no row lock, and `rate_limits` had no unique constraint per key.
Concurrent first-attempts inserted duplicate counter rows; concurrent increments all read the
same count, all passed the cap check, all wrote back (lost update). A burst multiplied every cap
— admin login, 2FA/OTP brute-force, webhook flood, grant.

**Fix:** insert-if-absent (`onConflictDoNothing` on a new per-key **unique** index) → `SELECT …
FOR UPDATE` → conditional update, so the check-then-increment is atomic. Migration `0026` adds
the unique indexes (dedups any pre-existing duplicate counter rows first, idempotent). Proven
with a 50-way concurrent probe (exactly `max` allowed, single counter row). Commit `cc420c2`.

## R15 — Admin self-signup endpoint open ✅ Resolved

**Was:** `apps/admin/src/lib/server/auth.ts` had `emailAndPassword: { enabled: true }` with no
`disableSignUp`, so `POST /api/auth/sign-up/email` accepted anonymous `admin_user` creation
(email-squatting an invitee's address / DB pollution).

**Fix:** `disableSignUp: true`. Staff are created only via the owner-only `/staff` invite flow
(`internalAdapter.createUser`), never the auth-API signup route.

## R16 — Mandatory admin 2FA gate missing on API endpoints ✅ Resolved

**Was:** the 2FA-enrollment gate lived only in `(app)/+layout.server.ts`; `hooks.server.ts`
exposes `locals.user` to any *active* staff regardless of `twoFactorEnabled` (so `/enroll-2fa`
can run). The non-`(app)` API routes `/api/connected` (live dashboard SSE) and `/api/router-log`
checked only `locals.user`, so an un-enrolled session (or an attacker with just the password of
a not-yet-enrolled invitee) could `curl` them.

**Fix:** both endpoints now also require `event.locals.user.twoFactorEnabled` (`403` otherwise).
Kept per-endpoint rather than central, because `/enroll-2fa` itself needs `locals.user` while
`twoFactorEnabled` is still false.

## R17 — CSV formula injection in Finance export ✅ Resolved

**Was:** `finance/export/+server.ts` `cell()` did RFC-4180 quoting but didn't neutralize
spreadsheet formulas. `buyerName`/`buyerEmail` come from the Maya checkout (buyer-controlled), so
a value like `=HYPERLINK(…)` or a DDE payload executed when an operator opened the export.

**Fix:** `cell()` prefixes any value starting with `= + - @ \t \r` with a single quote before
quoting, forcing it to plain text.

## R18 — Finance settled-revenue double-count ✅ Resolved

**Was:** `payment_transactions` is keyed by the gateway tx id, derived **differently** by the two
recording paths — the webhook uses the Maya payment id, the on-return poll / reconcile fall back
to the checkout id (`maya.ts` `getCheckoutStatus`). When they diverge, one payment writes two
`PAYMENT_SUCCESS` rows and "Gross Revenue (settled)" inflates (crediting stays correct — the
checkout claim guards that). Hinges on the unconfirmed Maya `getCheckoutStatus` payment-id field.

**Fix:** `recordPaymentTransaction` (`reconcilePayments.ts`) dedupes on `referenceNo`
(requestReferenceNumber, identical across both paths) — if a row already exists for this
referenceNo under a different id, it updates that row instead of inserting a divergent duplicate.
Reporting-only, no schema change; an airtight version (partial unique index on `reference_no`)
plus confirming the Maya field stays a follow-up.

## R19 — OTP-send throttle bypassable via the direct endpoint ✅ Resolved

**Was:** the per-phone/MAC OTP cap (R1, `enforceOtpSendLimit`) was wired only into the `login` /
`auth/verify` form actions, so a direct `POST /api/auth/phone-number/send-otp` (mounted by the
better-auth handler) skipped it — re-opening the SMS-bomb / credit-drain R1 was meant to close.

**Fix:** enforcement moved to the `sendOTP` callback in `apps/customer/src/lib/server/auth.ts` —
the one seam every send (form *and* direct endpoint) passes through. The form actions keep their
pre-check (for the friendly retry message + MAC dimension) and set `locals.otpLimitEnforced` so
the callback doesn't double-count a legitimate send; a direct call (no portal context) falls back
to a phone-only cap. `otpRateLimit.ts` itself (teammate-owned) was not modified — only called.

## R20 — Low-severity hardening batch ✅ Resolved (2026-06-29)

- **Security headers** on both apps' `hooks.server.ts` (set on the resolved response):
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, anti-framing, and HSTS
  **only over HTTPS** (the LAN deploys run plain HTTP). Admin uses `X-Frame-Options: DENY` /
  CSP `frame-ancestors 'none'` (owner actions must never be framed); the customer portal uses
  `SAMEORIGIN` / `'self'` so the OS captive popup (top-level, not framed) isn't broken. A full
  script/style CSP is intentionally out of scope (needs per-app nonce wiring).
- **Webhook error no longer reflected** — `webhooks/payment/+server.ts` returns a generic
  `Webhook verification failed`; the gateway/internal detail stays in the server log only (no
  info-disclosure / payment-id probing to an unauthenticated caller).
- **MAC case-normalization** — `bindMacTx` (`sessions.ts`) canonicalizes the MAC to uppercase at
  the DB-binding boundary, so `aa:bb…` vs `AA:BB…` for one device reuses a single
  `network_sessions` row instead of spawning a duplicate (spurious device-cap eviction).
- **Proxy-IP trust documented** — both `.env.example` files now explain `ADDRESS_HEADER` /
  `XFF_DEPTH`: leave unset when the app terminates connections (un-spoofable TCP peer); set them
  only behind a trusted proxy, with the right hop count, or per-IP throttles become spoofable
  (wrong depth) or collapse to one bucket (unset behind a proxy → lockout DoS).

**Regression tests added** to lock in earlier fixes: CSV `cell()` formula-escaping
(`apps/admin/src/lib/server/csv.test.ts`, R17) and `recordPaymentTransaction` referenceNo dedupe
(`apps/customer/src/lib/server/record-payment.spec.ts`, R18).

---

## How to use this file

- Touching auth, payments, the router grant, or any new endpoint? Skim this first.
- Fixed something? Flip its status to ✅, add the date, and link the PR/commit.
- Found a new risk? Add a row + a short section. Keep severity honest for *this*
  app's scale.
