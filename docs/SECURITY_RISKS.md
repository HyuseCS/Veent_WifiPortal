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
| R9 | Router management plane (Winbox/Dude/API) reachable from the internet | High | 🟡 Mitigated | — |
| R10 | Portal↔router API runs in cleartext (port 8728, no TLS) | Medium | ✅ Resolved | — |
| R11 | node-routeros connection timeout crashes the whole app server | Medium | ✅ Resolved | — |

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

## How to use this file

- Touching auth, payments, the router grant, or any new endpoint? Skim this first.
- Fixed something? Flip its status to ✅, add the date, and link the PR/commit.
- Found a new risk? Add a row + a short section. Keep severity honest for *this*
  app's scale.
