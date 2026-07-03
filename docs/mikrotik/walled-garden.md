# MikroTik Walled-Garden Runbook

The walled garden lets a guest device reach a small, fixed set of hosts **before it
authenticates** — the payment gateway, the reCAPTCHA assets that gateway's checkout page
loads, and our own portal/admin origin (Core Business Rule #2). Everything else stays blocked
until a grant drops the firewall for that MAC.

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

The host layer can only match the **hostname** (SNI), never the path — so allowing `*.google.com`
for reCAPTCHA also exposes Google search to pre-auth devices. That's an accepted, bounded
trade-off (other domains stay blocked); see the note in `setup-router.ts`.

---

## Hosts to allow (`/ip hotspot walled-garden`)

These mirror the `PAYMENT_HOSTS` array in `apps/admin/scripts/setup-router.ts`, which in turn
mirrors what is **live on the router** (the captcha hosts use `*.` wildcards there — match that).
**Pin this list against that array** when either changes.

```
# Maya / PayMaya checkout + redirect + API (wildcards cover sandbox + prod)
/ip hotspot walled-garden add action=allow dst-host=maya.ph        comment=veent-admin
/ip hotspot walled-garden add action=allow dst-host=*.maya.ph      comment=veent-admin
/ip hotspot walled-garden add action=allow dst-host=paymaya.com    comment=veent-admin
/ip hotspot walled-garden add action=allow dst-host=*.paymaya.com  comment=veent-admin

# GCash e-wallet checkout — Maya/PayMongo redirect the buyer to GCash to authorize payment.
/ip hotspot walled-garden add action=allow dst-host=gcash.com      comment=veent-admin
/ip hotspot walled-garden add action=allow dst-host=*.gcash.com    comment=veent-admin

# Google reCAPTCHA — Maya's checkout embeds the google.com reCAPTCHA variant. Wildcards to
# match the live router. *.google.com is REQUIRED and is a deliberate, bounded leak (see note above).
/ip hotspot walled-garden add action=allow dst-host=*.google.com    comment=veent-admin
/ip hotspot walled-garden add action=allow dst-host=*.gstatic.com   comment=veent-admin
/ip hotspot walled-garden add action=allow dst-host=*.recaptcha.net comment=veent-admin

# Other gateways named in Rule #2 — harmless if unused on this deployment.
/ip hotspot walled-garden add action=allow dst-host=*.paymongo.com comment=veent-admin
/ip hotspot walled-garden add action=allow dst-host=*.xendit.co    comment=veent-admin

# Our portal / admin origin (derived from ORIGIN). Replace with your LAN hostname,
# OR add it at the IP layer below if ORIGIN is a bare IP.
/ip hotspot walled-garden add action=allow dst-host=admin.veent.lan comment=veent-admin
```

### Deny the OS connectivity-check probes (ordering matters)

The broad `*.google.com` / `*.gstatic.com` allows above (needed for Maya's reCAPTCHA) also happen to
whitelist **Android's captive-portal probe hosts** — so an un-granted phone gets a real `204` from
Google, flashes **"Connected"**, then reverts to **"Sign in to network."** (See
`docs/problems/captive-connected-flap-on-free-time.md`.) Punch those specific probe hosts back with
**`action=deny` rules placed ABOVE the allows** — walled-garden matching is **first-match,
top-to-bottom**, so a deny only wins if it sits before the `*` allow. None of these hosts/paths is a
reCAPTCHA resource (reCAPTCHA lives on `www.gstatic.com/recaptcha` and `www.google.com/recaptcha`),
so denying them does not affect payments.

```
# Add with place-before so they land at the TOP, ahead of the *.google.com / *.gstatic.com allows.
# (`bun run setup:router` does this automatically — it is idempotent, so re-running never dupes.)
/ip hotspot walled-garden add action=deny dst-host=connectivitycheck.gstatic.com comment=veent-admin place-before=0
/ip hotspot walled-garden add action=deny dst-host=clients3.google.com           comment=veent-admin place-before=0
/ip hotspot walled-garden add action=deny dst-host=connectivitycheck.android.com comment=veent-admin place-before=0
# www.google.com is needed by reCAPTCHA, so deny ONLY the probe path (HTTP-only match):
/ip hotspot walled-garden add action=deny dst-host=www.google.com path=/generate_204 comment=veent-admin place-before=0
```

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
- Checkout page renders but the captcha never appears (works on a fully-online device) → a
  `*.google.com` / `*.gstatic.com` / `*.recaptcha.net` rule is missing.
- Card payment dead-ends after entering card details → the bank ACS host is missing (see 3DS above).

## Idempotency / cleanup

The script matches existing entries by `dst-host` / `dst-address` and skips duplicates, and
tags everything it creates with `comment=veent-admin`. To audit or remove only the entries this
tooling created:

```
/ip hotspot walled-garden print where comment=veent-admin
/ip hotspot walled-garden remove [find comment=veent-admin]
```
