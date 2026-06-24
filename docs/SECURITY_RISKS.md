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
| R4 | `/api/network/grant` spend→grant is not transactional | Medium | ✅ Resolved | — |
| R5 | Maya webhook signature scheme is an unconfirmed assumption | Medium | ✅ Resolved (moot by design) | — |
| R6 | `/register` admin hole mints an active owner per submit | High (dev-only) | ✅ Resolved (deleted) | — |
| R7 | No rate limit on login/register, webhook, cron, SSE, Finance export | Low–Med | ✅ Resolved | — |
| R8 | No config fail-fast for `CRON_SECRET` / payment keys / `DATABASE_URL` | Low | ✅ Resolved | — |
| R9 | Router management plane (Winbox/Dude/API) reachable from the internet | High | 🟡 Mitigated | — |
| R10 | Portal↔router API runs in cleartext (port 8728, no TLS) | Medium | 🔵 Deferred (TODO) | unassigned |

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

## R10 — Portal↔router API is cleartext 🔵 Deferred (TODO)

The admin app reaches the router over the **plain RouterOS API** (`MIKROTIK_HOST=10.0.0.1`,
`MIKROTIK_PORT=8728`, `MIKROTIK_TLS=false`), so the `veent-portal` API user's
password crosses the wire **unencrypted**. Because guests are on the **same
`10.0.0.0/24`** as the router (per DHCP leases), a guest on that L2 segment could
sniff/MITM the API credentials.

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
2. Set `apps/admin/.env`: `MIKROTIK_PORT="8729"`, `MIKROTIK_TLS="true"`,
   `MIKROTIK_TLS_INSECURE="true"` (self-signed).
3. Restart the admin app, verify a grant/revoke works, **then** `/ip service set api disabled=yes`.

**Stronger structural option:** move guests to their own VLAN/subnet with hotspot
client isolation, so they can't reach or sniff the management segment at all.

---

## How to use this file

- Touching auth, payments, the router grant, or any new endpoint? Skim this first.
- Fixed something? Flip its status to ✅, add the date, and link the PR/commit.
- Found a new risk? Add a row + a short section. Keep severity honest for *this*
  app's scale.
