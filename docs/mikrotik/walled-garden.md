# MikroTik Walled-Garden Runbook

The walled garden lets a guest device reach a small, fixed set of hosts **before it
authenticates** — the payment gateway and our own portal/admin origin (Core Business Rule #2).
The reCAPTCHA assets Maya's checkout page loads are **not** in this global list anymore; they're
opened **per-device, scoped to the paying device's IP, at checkout time** (see [reCAPTCHA is
per-device](#recaptcha-is-opened-per-device-at-checkout-not-global) below). Everything else stays
blocked until a grant drops the firewall for that MAC.

This runbook is the **operator-facing mirror** of what the code provisions automatically. The
source of truth is still the script — keep this file in sync with it when the host list changes:

- Script: `bun run --filter radius-admin setup:router` →
  `apps/admin/scripts/setup-router.ts`
- Core call: `provisionWalledGarden()` in
  `packages/core/src/integrations/network/mikrotik.ts`

Use the script for normal provisioning (it's idempotent — re-running only adds what's missing).
Use the manual commands below when you're on the router console, auditing the live config, or
provisioning a router the app server can't reach over the API.

---

## ⚠️ The payment webhook needs NO walled-garden rule

A common misconception: the Maya **webhook** (`POST /api/webhooks/payment`) is
**server-to-server** — Maya's backend calls **our** backend directly. It never traverses the
guest hotspot, so it is **not** subject to the walled garden and needs **no** rule here.

What the walled garden is for is the **client's** path: the guest's phone reaching Maya's
checkout/redirect/3DS pages and the reCAPTCHA assets, plus our portal origin. Only those
client-side hosts go below.

---

## Two layers

| RouterOS path                  | Matches on                                                              | Use for                                                                 |
| ------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `/ip hotspot walled-garden`    | `dst-host` (TLS SNI / HTTP Host — **hostname**, supports `*` wildcards) | HTTP/HTTPS hosts (all the payment + captcha + portal hosts)             |
| `/ip hotspot walled-garden ip` | `dst-address` (**IP/CIDR**, all protocols)                              | A host that needs non-HTTP/HTTPS, or a portal origin given as a bare IP |

The host layer can only match the **hostname** (SNI), never the path. That's exactly why reCAPTCHA is
opened per-device at checkout (scoped to the device IP) rather than globally: a global `*.google.com`
allow would leak Google to every pre-auth device *and* let Android's captive probe return a real `204`
(the "connected"-then-reverts flap). See the note in `setup-router.ts`.

---

## Hosts to allow (`/ip hotspot walled-garden`)

These mirror the `PAYMENT_HOSTS` array in `apps/admin/scripts/setup-router.ts`, which in turn
mirrors what is **live on the router**. **Pin this list against that array** when either changes. The
reCAPTCHA hosts are deliberately **not** here — see
[reCAPTCHA is per-device](#recaptcha-is-opened-per-device-at-checkout-not-global) below.

```
# Maya / PayMaya checkout + redirect + API (wildcards cover sandbox + prod)
/ip hotspot walled-garden add action=allow dst-host=maya.ph        comment=veent-admin
/ip hotspot walled-garden add action=allow dst-host=*.maya.ph      comment=veent-admin
/ip hotspot walled-garden add action=allow dst-host=paymaya.com    comment=veent-admin
/ip hotspot walled-garden add action=allow dst-host=*.paymaya.com  comment=veent-admin

# GCash e-wallet checkout — Maya/PayMongo redirect the buyer to GCash to authorize payment.
/ip hotspot walled-garden add action=allow dst-host=gcash.com      comment=veent-admin
/ip hotspot walled-garden add action=allow dst-host=*.gcash.com    comment=veent-admin

# Other gateways named in Rule #2 — harmless if unused on this deployment.
/ip hotspot walled-garden add action=allow dst-host=*.paymongo.com comment=veent-admin
/ip hotspot walled-garden add action=allow dst-host=*.xendit.co    comment=veent-admin

# Our portal / admin origin (derived from ORIGIN). Replace with your LAN hostname,
# OR add it at the IP layer below if ORIGIN is a bare IP.
/ip hotspot walled-garden add action=allow dst-host=admin.veent.lan comment=veent-admin

# NOTE: reCAPTCHA hosts (www.google.com, www.gstatic.com, www.recaptcha.net) are NOT global here —
# openCheckoutAccess opens them per-device at checkout. See the section below.
```

### reCAPTCHA is opened per-device at checkout (not global)

Maya's checkout page renders a Google reCAPTCHA served from `www.google.com` / `www.gstatic.com` /
`www.recaptcha.net`. These are **deliberately kept out of the global list**: a global `*.google.com`
allow would expose Google to every pre-auth device and let Android's captive probe return a real `204`
(the flap above). Instead the customer app opens exactly those three hosts **scoped to the paying
device's IP**, tagged `veent-checkout:<epochMs>`, the moment the buyer reaches the Maya checkout page:

- Hosts: `CHECKOUT_ACCESS_HOSTS` in `packages/core/src/services/checkoutAccess.ts`
  (`www.google.com`, `www.gstatic.com`, `www.recaptcha.net`).
- Opened by `openCheckoutAccess()` (called from `apps/customer/.../top-up/+page.server.ts`); each rule
  carries `src-address=<device-ip>`, so it never opens Google for any other device.
- Swept on a TTL by the customer revoke cron (`sweepHostAccess`, `veent-checkout` tag) — see the B3.6
  check in [`bench-verify.md`](./bench-verify.md).

So on the live router you'll see transient `comment=veent-checkout:<ts>` rules appear during a checkout
and get reaped afterward — that's expected, not drift.

### Deny the OS connectivity-check probes (ordering matters)

`setup:router` provisions an explicit **`action=deny`** set for the OS captive-portal probe hosts,
tagged `comment=veent-admin`. They guard against the **"Connected"-then-reverts flap** (See
`docs/problems/captive-connected-flap-on-free-time.md`): whenever a `www.google.com` / `www.gstatic.com`
allow is in play — the **per-device checkout allow** above, or any broad allow an operator adds by hand
— an un-granted phone could otherwise get a real `204` and flash **"Connected"** then revert to **"Sign
in to network."** The denies sit **ABOVE the allows** — walled-garden matching is **first-match,
top-to-bottom**, so a deny only wins if it sits before the allow. None of these hosts/paths is a
reCAPTCHA resource (reCAPTCHA lives on `www.gstatic.com/recaptcha` and `www.google.com/recaptcha`),
so denying them does not affect payments.

```
# Add with place-before so they land at the TOP, ahead of any google/gstatic allow (the per-device
# checkout allow, or a manual one). (`bun run setup:router` does this automatically and idempotently.)
/ip hotspot walled-garden add action=deny dst-host=connectivitycheck.gstatic.com comment=veent-admin place-before=0
/ip hotspot walled-garden add action=deny dst-host=clients3.google.com           comment=veent-admin place-before=0
/ip hotspot walled-garden add action=deny dst-host=connectivitycheck.android.com comment=veent-admin place-before=0
# www.google.com is needed by reCAPTCHA, so deny ONLY the probe path (HTTP-only match):
/ip hotspot walled-garden add action=deny dst-host=www.google.com path=/generate_204 comment=veent-admin place-before=0
# Apple (iOS/macOS), Windows and Firefox probes too, so the OS "Sign in to network" popup fires on
# every platform — not just Android. Unlike the Google set these aren't behind any allow (so they're
# already intercepted by default); the explicit deny makes the popup robust and documents intent.
/ip hotspot walled-garden add action=deny dst-host=captive.apple.com        comment=veent-admin place-before=0
/ip hotspot walled-garden add action=deny dst-host=www.msftconnecttest.com  comment=veent-admin place-before=0
/ip hotspot walled-garden add action=deny dst-host=www.msftncsi.com         comment=veent-admin place-before=0
/ip hotspot walled-garden add action=deny dst-host=detectportal.firefox.com comment=veent-admin place-before=0
```

The full deny set lives in `PROBE_DENIES` (`apps/admin/scripts/setup-router.ts`); `bun run setup:router`
applies it idempotently, so prefer that over adding rows by hand.

**Verify the fix on an un-granted device** (before relying on it):

```
# From a phone still behind the portal (NOT yet granted):
curl -v http://connectivitycheck.gstatic.com/generate_204
# BEFORE the deny: returns 204 (the leak). AFTER: intercepted/redirected to the portal (fixed).

# Confirm ordering on the router — the deny rows must appear ABOVE the *.google.com/*.gstatic.com allows:
/ip hotspot walled-garden print
```

### 3-D Secure / card ACS — per-deployment

Card payments may step up to the **issuing bank's** ACS domain, which can't be predicted in
advance. E-wallet / Maya-wallet checkout is fully covered by `*.maya.ph` above. If card
payments dead-end on the 3DS redirect, capture the failing host from the router's DNS cache
(`/ip dns cache print` while reproducing) and add it:

```
/ip hotspot walled-garden add action=allow dst-host=<bank-acs-host> comment=veent-admin
```

## IPs to allow (`/ip hotspot walled-garden ip`)

Only when a host needs **non-HTTP/HTTPS**, or the portal origin is a bare LAN IP rather than a
hostname (mirrors `ADMIN_WG_IPS` + the IP branch for `ORIGIN`):

```
# Live deployment: the portal/admin origin is the bare IP 10.210.0.9 (on 10.210.0.0/18).
/ip hotspot walled-garden ip add action=accept dst-address=10.210.0.9 comment=veent-admin
```

---

## Verify

```
# List what's open pre-auth — confirm every host above is present exactly once.
/ip hotspot walled-garden print
/ip hotspot walled-garden ip print

# Watch DNS the device actually resolves while reproducing a stuck checkout —
# any host here that ISN'T in the walled garden is a candidate to add.
/ip dns cache print
```

Symptoms a missing entry causes:

- Checkout redirect (`payments-web*.maya.ph`) shows a closed connection → a `*.maya.ph` rule is missing.
- Checkout page renders but the captcha never appears (works on a fully-online device) → the
  per-device checkout access didn't open — no `veent-checkout:<ts>` rule for the device IP (check the
  `[topup] openCheckoutAccess failed` log, or that the device's MAC/IP resolved).
- Card payment dead-ends after entering card details → the bank ACS host is missing (see 3DS above).

## Idempotency / cleanup

The script matches existing entries by `dst-host` / `dst-address` and skips duplicates, and
tags everything it creates with `comment=veent-admin`. To audit or remove only the entries this
tooling created:

```
/ip hotspot walled-garden print where comment=veent-admin
/ip hotspot walled-garden remove [find comment=veent-admin]
```
