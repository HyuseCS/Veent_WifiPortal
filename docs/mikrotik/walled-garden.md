# MikroTik Walled-Garden Runbook (canonical)

The walled garden lets a guest device reach a small, fixed set of hosts **before it
authenticates** — the OS captive-probe denies, the payment gateways, and our own portal/admin
origin (Core Business Rule #2). Everything else stays blocked until a grant drops the firewall for
that MAC.

**This doc is the source-of-truth description of the exact live state the code provisions.** The
walled garden is code-owned: `bun run --filter radius-admin setup:router` rebuilds it from
`apps/admin/scripts/walled-garden-config.ts`. Every code-owned row carries a `comment` tag in the
`veent-admin:<group>` family, so no row is ever hand-guessed. Keep this file in sync with the config
when the host list changes.

- Script: `bun run --filter radius-admin setup:router` → `apps/admin/scripts/setup-router.ts`
- Host/deny arrays: `apps/admin/scripts/walled-garden-config.ts` (`PAYMENT_HOSTS`, `PROBE_DENIES`)
- Core call: `provisionWalledGarden()` / `reconcileWalledGarden()` in
  `packages/core/src/integrations/network/mikrotik.ts`

Use the script for normal provisioning (it's idempotent — re-running only adds what's missing). Use
the manual commands below when you're on the router console, auditing the live config, doing a hard
reset, or provisioning a router the app server can't reach over the API.

---

## The four row families (tags)

Every row on the walled garden is one of these. The first three are code-owned and provisioned by
`setup:router` in a **load-bearing order — probe → payment → portal** (see [The 3-call split](#the-3-call-split-and-why-order-matters)):

| Tag                   | Menu                                 | Rows                                                             | Provisioned by                                              |
| --------------------- | ------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| `veent-admin:probe`   | `walled-garden` (`action=deny`)      | OS captive-probe hosts (`PROBE_DENIES`)                          | `setup:router` call 1                                       |
| `veent-admin:payment` | `walled-garden` (`action=allow`)     | payment-gateway hosts (`PAYMENT_HOSTS`)                          | `setup:router` call 2                                       |
| `veent-admin:portal`  | `walled-garden` + `walled-garden ip` | admin/portal origin (`ORIGIN` + `ADMIN_WG_HOSTS`/`ADMIN_WG_IPS`) | `setup:router` call 3                                       |
| `gcash-auto`          | `walled-garden ip`                   | one self-healing GCash edge IP                                   | the `gcash-resolve` scheduler (not `provisionWalledGarden`) |

A fifth, **transient** family appears only during a checkout: `veent-checkout:<epochMs>` — per-device
reCAPTCHA allows scoped to the paying device's IP, opened and swept by the customer app (see
[reCAPTCHA is per-device](#recaptcha-is-opened-per-device-at-checkout-not-global)).

Anything with **no tag** is an operator-added manual row. `setup:router` never creates untagged
rows, and `--reconcile` never touches them.

---

## ⚠️ The payment webhook needs NO walled-garden rule

A common misconception: the Maya **webhook** (`POST /api/webhooks/payment`) is **server-to-server** —
Maya's backend calls **our** backend directly. It never traverses the guest hotspot, so it is **not**
subject to the walled garden and needs **no** rule here.

What the walled garden is for is the **client's** path: the guest's phone reaching the payment
gateway's checkout/redirect/3DS pages and the reCAPTCHA assets, plus our portal origin.

---

## Two layers

| RouterOS path                  | Matches on                                                              | Use for                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `/ip hotspot walled-garden`    | `dst-host` (TLS SNI / HTTP Host — **hostname**, supports `*` wildcards) | HTTP/HTTPS hosts (payment + portal hosts) and the `action=deny` probes                                |
| `/ip hotspot walled-garden ip` | `dst-address` (**IP/CIDR**, all protocols)                              | A host that needs non-HTTP/HTTPS, a portal origin given as a bare IP, or the resolved `gcash-auto` IP |

The host layer can only match the **hostname** (SNI), never the path (except an HTTP-only `path=`
match). That's exactly why reCAPTCHA and GCash's rotating CDN IP are handled specially below.

---

## `veent-admin:probe` — deny the OS connectivity-check probes (ordering matters)

`setup:router` provisions an explicit **`action=deny`** set for the OS captive-portal probe hosts,
tagged `comment=veent-admin:probe`. They guard against the **"Connected"-then-reverts flap** (see
`docs/problems/captive-connected-flap-on-free-time.md`): whenever a `www.google.com` /
`www.gstatic.com` allow is in play — the per-device checkout allow, or any broad allow an operator
adds by hand — an un-granted phone could otherwise get a real `204` and flash **"Connected"** then
revert to **"Sign in to network."** The denies sit **ABOVE the allows** (walled-garden matching is
**first-match, top-to-bottom**), so a deny only wins if it sits before the allow. None of these
hosts/paths is a reCAPTCHA resource, so denying them does not affect payments.

```
# Provisioned first, with place-before so they land at the TOP, ahead of any allow.
/ip hotspot walled-garden add action=deny dst-host=connectivitycheck.gstatic.com comment=veent-admin:probe place-before=0
/ip hotspot walled-garden add action=deny dst-host=clients1.google.com           comment=veent-admin:probe place-before=0
/ip hotspot walled-garden add action=deny dst-host=clients2.google.com           comment=veent-admin:probe place-before=0
/ip hotspot walled-garden add action=deny dst-host=clients3.google.com           comment=veent-admin:probe place-before=0
/ip hotspot walled-garden add action=deny dst-host=clients4.google.com           comment=veent-admin:probe place-before=0
/ip hotspot walled-garden add action=deny dst-host=connectivitycheck.android.com comment=veent-admin:probe place-before=0
# www.google.com is needed by reCAPTCHA, so deny ONLY the probe path (HTTP-only match):
/ip hotspot walled-garden add action=deny dst-host=www.google.com path=/generate_204 comment=veent-admin:probe place-before=0
# Apple (iOS/macOS), Windows and Firefox probes too, so the OS "Sign in to network" popup fires on
# every platform. Unlike the Google set these aren't behind any allow (so they're already
# intercepted by default); the explicit deny makes the popup robust and documents intent.
/ip hotspot walled-garden add action=deny dst-host=captive.apple.com        comment=veent-admin:probe place-before=0
/ip hotspot walled-garden add action=deny dst-host=www.msftconnecttest.com  comment=veent-admin:probe place-before=0
/ip hotspot walled-garden add action=deny dst-host=www.msftncsi.com         comment=veent-admin:probe place-before=0
/ip hotspot walled-garden add action=deny dst-host=detectportal.firefox.com comment=veent-admin:probe place-before=0
```

The full deny set lives in `PROBE_DENIES` (`apps/admin/scripts/walled-garden-config.ts`);
`setup:router` applies it idempotently. **Never remove these** — `--reconcile` is add-only for deny
rows by construction (it only ever removes `action=allow` rows), precisely so a prune can't re-open
the flap.

**Verify the fix on an un-granted device:**

```
# From a phone still behind the portal (NOT yet granted):
curl -v http://connectivitycheck.gstatic.com/generate_204
# BEFORE the deny: returns 204 (the leak). AFTER: intercepted/redirected to the portal (fixed).

# Confirm ordering — the deny rows must appear ABOVE the allow rows:
/ip hotspot walled-garden print
```

---

## `veent-admin:payment` — payment-gateway allow hosts

These mirror the `PAYMENT_HOSTS` array in `apps/admin/scripts/walled-garden-config.ts`, which in turn
mirrors what is **live on the router**. Codified from live router hit-data (RouterOS 6.49.18) — the
over-broad manual `*keyword*` substring wildcards (`*alipay*`, `*gcash*`, `*g-xchange*`) are replaced
by enumerated `*.domain` forms.

```
# Maya / PayMaya checkout + redirect + API (wildcards cover sandbox + prod)
/ip hotspot walled-garden add action=allow dst-host=maya.ph        comment=veent-admin:payment
/ip hotspot walled-garden add action=allow dst-host=*.maya.ph      comment=veent-admin:payment
/ip hotspot walled-garden add action=allow dst-host=paymaya.com    comment=veent-admin:payment
/ip hotspot walled-garden add action=allow dst-host=*.paymaya.com  comment=veent-admin:payment

# GCash e-wallet checkout — Maya/PayMongo redirect the buyer to GCash to authorize payment.
/ip hotspot walled-garden add action=allow dst-host=gcash.com      comment=veent-admin:payment
/ip hotspot walled-garden add action=allow dst-host=*.gcash.com    comment=veent-admin:payment

# Other gateways named in Rule #2 — harmless if unused on this deployment.
/ip hotspot walled-garden add action=allow dst-host=*.paymongo.com comment=veent-admin:payment
/ip hotspot walled-garden add action=allow dst-host=*.xendit.co    comment=veent-admin:payment

# Alipay/Ant cashier — GCash checkout runs through the Alipay-powered cashier. Enumerated *.domain
# forms replace the over-broad `*alipay*` substring. BARE alipay.com is required IN ADDITION to the
# wildcard: a `*.` wildcard does NOT match its own bare parent host, so `*.alipay.com` alone leaves
# `alipay.com` blocked — the retired `*alipay*` substring used to catch it.
/ip hotspot walled-garden add action=allow dst-host=alipay.com          comment=veent-admin:payment
/ip hotspot walled-garden add action=allow dst-host=*.alipay.com        comment=veent-admin:payment
/ip hotspot walled-garden add action=allow dst-host=*.alipayobjects.com comment=veent-admin:payment
/ip hotspot walled-garden add action=allow dst-host=*.alicdn.com        comment=veent-admin:payment
/ip hotspot walled-garden add action=allow dst-host=*.antgroup.com      comment=veent-admin:payment

# GCash/Mynt/G-Xchange infra. Replaces the over-broad `*g-xchange*` substring.
/ip hotspot walled-garden add action=allow dst-host=*.mynt.xyz      comment=veent-admin:payment
/ip hotspot walled-garden add action=allow dst-host=*.g-xchange.com comment=veent-admin:payment

# Google Pay checkout — specific hosts only. NOT broad *.google.com (that re-opens the captive-probe
# flap — see the reCAPTCHA note below).
/ip hotspot walled-garden add action=allow dst-host=pay.google.com      comment=veent-admin:payment
/ip hotspot walled-garden add action=allow dst-host=payments.google.com comment=veent-admin:payment

# Google login / SetSID for the Google Pay flow. Bare accounts.google.com is required — a `*.`
# wildcard does NOT match its own bare parent host; the .com.ph ccTLD is where SetSID's
# cross-domain-cookie step bounces. Both resolve DIRECTLY to Google IPs (no CNAME-to-CDN), so plain
# host rules suffice. Still NOT broad *.google.com.
/ip hotspot walled-garden add action=allow dst-host=accounts.google.com    comment=veent-admin:payment
/ip hotspot walled-garden add action=allow dst-host=accounts.google.com.ph comment=veent-admin:payment

# KEEP — proven needed by live traffic (98 hits). *.googleapis.com is a broad surface; dropping a
# 98-hit rule risks breaking checkout, so it stays. Tightening to exact subpaths needs a live capture
# of which paths checkout uses (backlog candidate) — do NOT silently drop.
/ip hotspot walled-garden add action=allow dst-host=*.googleapis.com comment=veent-admin:payment
```

### Why `*.google.com` / `*.gstatic.com` / `*.recaptcha.net` are NOT allowed here

**Do not "helpfully" re-add broad Google/gstatic/recaptcha allow rows** — not even disabled ones. The
hard reset deliberately drops them, and here is why:

- A global `*.google.com` / `*.gstatic.com` allow lets **Android's captive probe**
  (`.../generate_204`) return a real `204` **pre-auth**, so every connecting guest briefly flashes
  **"Connected"** then reverts to **"Sign in to network"** while still un-granted. MikroTik can't
  path-filter HTTPS, so the probe can't be blocked while `google.com` is open at the host level.
- The reCAPTCHA that Maya's checkout page renders lives on `www.google.com/recaptcha` and
  `www.gstatic.com/recaptcha` — **paths**, not distinct hosts. The `veent-admin:probe` deny rows
  above enforce the flap fix; the reCAPTCHA assets are opened **per-device at checkout** instead
  (next section).
- A disabled broad-Google row surviving a rebuild for "just in case" reintroduces exactly the
  "why is this here" guessing problem this canonical setup exists to close. If you think you need
  Google open globally, you almost certainly need a **per-device checkout allow** or a specific
  **host** in `PAYMENT_HOSTS`, not a broad wildcard.

### reCAPTCHA is opened per-device at checkout (not global)

The customer app opens `www.google.com`, `www.gstatic.com`, `www.recaptcha.net` **scoped to the
paying device's IP**, tagged `veent-checkout:<epochMs>`, the moment the buyer reaches the checkout
page:

- Hosts: `CHECKOUT_ACCESS_HOSTS` in `packages/core/src/services/checkoutAccess.ts`.
- Opened by `openCheckoutAccess()` (called from `apps/customer/.../top-up/+page.server.ts`); each
  rule carries `src-address=<device-ip>`, so it never opens Google for any other device.
- Swept on a TTL by the customer revoke cron (`sweepHostAccess`, `veent-checkout` tag).

So on the live router you'll see transient `comment=veent-checkout:<ts>` rules appear during a
checkout and get reaped afterward — that's expected, not drift.

### `gcash-auto` — GCash needs a CNAME resolve-script (not a host rule)

`payments.gcash.com` **CNAMEs to an Akamai edge** (`…edgekey.net` → `…akamaiedge.net`) whose IP
**rotates**. RouterOS v6 `dst-host` walled-garden matching **cannot follow a CNAME chain** to a
wildcard like `*.gcash.com`, so a host rule never matches and GCash checkout dead-ends — regardless
of plain vs. encrypted DNS (this is a CNAME-matching gap, **not** a DoH-hiding problem). The fix is a
`/system scheduler` item, `gcash-resolve`, that re-resolves the host every 5 minutes and upserts a
single `walled-garden ip` row (`comment="gcash-auto"`) with the fresh IP — self-healing as Akamai's
edge IP changes, no hardcoded IP:

- Provisioned by `provisionGcashResolveScheduler()` in `packages/core/.../mikrotik.ts`, called from
  `setup:router` alongside the host provisioning. Idempotent — matched by `name=gcash-resolve`, so a
  re-run is a no-op.
- The on-event body is a **hardcoded, static** RouterOS script (never templatized from data — a
  router-resident-scheduled-code injection guardrail).
- Distinct match keys: the scheduler **item** is keyed by `name=gcash-resolve`; the on-event body's
  own **upsert** target on the `walled-garden ip` layer is keyed by `comment="gcash-auto"`.

```
# What setup:router provisions (equivalent CLI form):
/system scheduler add name=gcash-resolve interval=5m on-event={
  :local ip [:resolve payments.gcash.com];
  :if ([:len [/ip hotspot walled-garden ip find comment="gcash-auto"]] = 0) do={
    /ip hotspot walled-garden ip add dst-address=$ip comment="gcash-auto"
  } else={
    /ip hotspot walled-garden ip set [find comment="gcash-auto"] dst-address=$ip
  }
}

# Confirm it's live and self-healing:
/system scheduler print where name=gcash-resolve
/ip hotspot walled-garden ip print where comment=gcash-auto
```

The `gcash-auto` row is **not** managed by `--reconcile` (its tag isn't in the `veent-admin:*`
family) — leave it to the scheduler to self-heal on its own ~5-minute cadence. Never hand-edit or
manually recreate it.

Rule of thumb: a payment host that CNAMEs to a CDN (GCash → Akamai) needs this resolve-script; a host
that resolves **directly** to the provider's own IP (all the Google hosts above) needs only a
`dst-host` rule.

### 3-D Secure / card ACS — per-deployment

Card payments may step up to the **issuing bank's** ACS domain, which can't be predicted in advance.
E-wallet / Maya-wallet checkout is fully covered by `*.maya.ph` above. If card payments dead-end on
the 3DS redirect, capture the failing host from the router's DNS cache (`/ip dns cache print` while
reproducing) and add it as a `veent-admin:payment` row (or, better, add it to `PAYMENT_HOSTS` and
re-run `setup:router`):

```
/ip hotspot walled-garden add action=allow dst-host=<bank-acs-host> comment=veent-admin:payment
```

---

## How to add a wallet/bank (₱0 recon protocol)

To whitelist a new e-wallet or bank you must discover the EXACT hosts its app/checkout flow hits,
then classify each one. Do this empirically — never guess from a research doc. The protocol costs
nothing (no test payment needed; walk up to, but do NOT confirm, the pay screen):

1. **Flush the router DNS cache** so the capture is clean:
   ```
   /ip dns cache flush
   ```
2. **Drive the flow on the captive device** (a phone still behind the portal, NOT yet granted): open
   the wallet/bank app, pull-to-refresh the dashboard, and walk the QRPH / pay flow all the way to
   the confirm screen — **do NOT confirm** (no real payment needed; you only need the app to make its
   network calls).
3. **Read what it resolved:**
   ```
   /ip dns cache print
   ```
   Every host the app touched now appears in the cache. Compare against what's already whitelisted;
   the new rows are your candidates.
4. **Classify each new domain:**
   - **Resolves directly to the provider's own IP** → add a plain `dst-host` entry to `PAYMENT_HOSTS`
     (`apps/admin/scripts/walled-garden-config.ts`) and re-run `setup:router`.
   - **CNAMEs to a CDN** (e.g. `…edgekey.net` / `…akamaiedge.net` / any rotating CDN edge) → a
     `dst-host` rule can NOT match it (RouterOS v6 can't follow a CNAME chain). It needs a `:resolve`
     scheduler like `gcash-resolve` (see `provisionGcashResolveScheduler` and the `gcash-auto`
     section above) that re-resolves the host every few minutes and upserts a `walled-garden ip` row.
5. **Add → re-run `setup:router` → retest** the flow on the captive device. Repeat until the flow
   completes.

**Two hard rules:**

- **`*.domain` never matches its own bare parent.** If a flow needs both `foo.com` and its
  subdomains, add BOTH `foo.com` and `*.foo.com` (see the bare `alipay.com` / `gcash.com` entries).
- **Do NOT add broad CDN allows** — no `*.google.com`, `*.gstatic.com`, `fonts.*`,
  `googletagmanager`, `cdnjs`, etc. They re-open the captive-probe flap that `PROBE_DENIES` fixes
  (an un-granted phone gets a real `204` and flashes "Connected" then reverts). If an app seems to
  need Google/Cloudflare assets, it almost certainly needs a **per-device checkout allow** or a
  specific host, not a broad wildcard.

**Domain open ≠ app works.** Opening the right hosts is necessary but NOT sufficient — many apps
cert-pin or actively detect captive networks and refuse to proceed even with every domain reachable
(Google Pay is the extreme case — see below). Every candidate needs a **live pass/fail** on real
hardware before you can call it supported.

### Google Pay — KNOWN-DEAD (excluded on purpose)

Google Pay is **not** a candidate and its hosts were removed from `PAYMENT_HOSTS`. Android's WebView
blocks it (`OR_BIBED_15`), so it can never complete inside the captive CNA regardless of what you
whitelist. This is a **WebView limitation, not a walled-garden gap** — do not re-add `pay.google.com`
/ `payments.google.com` / `accounts.google.com*` chasing it.

## Candidate wallets/banks (UNVERIFIED — recon required)

A curated shortlist of likely-useful wallets/banks for this audience. **Every row is UNVERIFIED** —
the roots below are starting points from research, NOT confirmed working. For each: run the ₱0 recon
protocol above, classify each host (direct vs CNAME-to-CDN), add, and get a live pass/fail before
treating it as supported. Do NOT add any of these to `PAYMENT_HOSTS` until live-verified.

| App           | Candidate root(s)                                       | Status     |
| ------------- | ------------------------------------------------------- | ---------- |
| GoTyme        | `*.gotyme.com.ph`                                       | UNVERIFIED |
| SeaBank       | `*.seabank.ph`, `*.seabank.com.ph`                      | UNVERIFIED |
| GrabPay       | `*.grab.com`                                            | UNVERIFIED |
| ShopeePay     | `*.shopeepay.ph`, `*.shopee.ph`                         | UNVERIFIED |
| Coins.ph      | `*.coins.ph`                                            | UNVERIFIED |
| BDO           | `*.bdo.com.ph`                                          | UNVERIFIED |
| BPI           | `*.bpi.com.ph`                                          | UNVERIFIED |
| Landbank      | `*.landbank.com`, `*.landbank.com.ph`, `lbpiaccess.com` | UNVERIFIED |
| Security Bank | `*.securitybank.com`, `*.securitybank.com.ph`           | UNVERIFIED |

**On the 4 bank rows (BDO / BPI / Landbank / Security Bank):** these support QR Ph, but banking apps
are especially likely to **cert-pin and/or detect captive networks** and refuse even with their
domains open. Treat a live pass/fail per app as mandatory — a resolving rule is no guarantee.

**Out of scope:** the OTHER traditional banks (Metrobank, RCBC, PNB, China Bank, EastWest, AUB,
PSBank, etc.) are NOT curated candidates — the "whitelist every QRPH bank" chase was already
rejected. Only BDO / BPI / Landbank / Security Bank are curated here alongside the 5 wallets.

---

## `veent-admin:portal` — admin/portal origin

The portal/admin origin the guest must reach pre-auth to see the sign-in page. Derived from `ORIGIN`
(an IP origin goes to the IP layer, a hostname to the host layer), plus any extra
`ADMIN_WG_HOSTS`/`ADMIN_WG_IPS`:

```
ADMIN_WG_HOSTS="admin.veent.lan,portal.veent.lan"   # comma-separated DNS names
ADMIN_WG_IPS="10.5.50.1,10.5.50.0/24"               # comma-separated IPs/CIDRs
```

```
# Hostname origin (host layer):
/ip hotspot walled-garden add action=allow dst-host=admin.veent.lan comment=veent-admin:portal

# Bare-IP origin (ip layer). Live staging deployment: the portal origin is a bare LAN IP.
/ip hotspot walled-garden ip add action=accept dst-address=10.210.0.9 comment=veent-admin:portal
```

`PAYMENT_HOSTS` is its **own** group (`veent-admin:payment`) and is **not** merged into the portal
set. If an `ADMIN_WG_HOSTS` value happens to duplicate a `PAYMENT_HOSTS` entry, `setup:router` logs a
warning — the same host would end up tagged under both groups (functionally harmless, since
provisioning is idempotent per-tag, but it muddies the tag audit).

---

## Hard reset + rebuild (canonical, from-scratch)

When the live garden has drifted (untagged operator rows, stale substrings, duplicates) and you want
to rebuild it EXACTLY from code, wipe **both** menus and re-run `setup:router`. This is the only way
to guarantee zero un-tagged rows.

> **Staging-only.** No production walled-garden change is authorized here. Wiping briefly makes
> payment hosts unreachable for the gap between the wipe and the rerun — acceptable on staging (no
> live guests), never on prod without a maintenance window.

The wipe is scripted — no manual `remove [find]` in Winbox/console. Two flags do it:

```
# Preview FIRST (destructive op — always dry-run before a real wipe):
bun run --filter radius-admin setup:router --wipe-only --dry-run

# One-shot hard reset: wipe BOTH menus (host layer AND ip layer), THEN rebuild from code
# (the 3-call split probe → payment → portal, then the gcash-resolve scheduler). Never leaves the
# garden empty — wipe and rebuild happen in a single run.
bun run --filter radius-admin setup:router --wipe

# Bare teardown only (wipe both menus and STOP — garden left empty until you re-run setup:router):
bun run --filter radius-admin setup:router --wipe-only
```

`--wipe-only` takes precedence over `--wipe`/`--reconcile`. Both flags SKIP RouterOS' dynamic (`D`)
auto-shadow rows — they're regenerated from the ip-layer entries and can't be removed directly.

Note: wiping `/ip hotspot walled-garden ip` also clears the `gcash-auto` row. `wipeWalledGarden` does
NOT touch the `gcash-resolve` scheduler, so it re-creates that row on its next ~5-minute tick — no
manual action needed.

### The 3-call split, and why order matters

`setup:router` calls `provisionWalledGarden` **three times** in this exact order:

```
call 1: provisionWalledGarden(config, { denies: PROBE_DENIES, tag: 'veent-admin:probe' })
call 2: provisionWalledGarden(config, { hosts: PAYMENT_HOSTS,  tag: 'veent-admin:payment' })
call 3: provisionWalledGarden(config, { hosts: portalHosts, ips: portalIps, tag: 'veent-admin:portal' })
```

**Probe first is load-bearing.** On a wiped/fresh garden, `provisionWalledGarden` derives its
deny-placement `beforeId` fresh per call — it finds the first enabled, non-dynamic, non-empty-dst-host
`action=allow` row and `place-before`s the denies ahead of it. Running probe first guarantees the
deny rows land at the very top of an empty garden, matching this doc's stated order. (Even a reordered
run would still place denies above the allows via the same mechanism — but do NOT reorder the calls
without re-verifying that derivation.)

### After a rebuild — verify

```
# Zero un-tagged rows, zero duplicates, every code-owned row tagged veent-admin:<group>:
/ip hotspot walled-garden print
/ip hotspot walled-garden ip print

# Clean reconcile (should report nothing to remove for all 3 groups):
bun run --filter radius-admin setup:router --reconcile --dry-run

# Scheduler present and self-healing:
/system scheduler print where name=gcash-resolve
/ip hotspot walled-garden ip print where comment=gcash-auto
```

Symptoms a missing entry causes:

- Checkout redirect (`payments-web*.maya.ph`) shows a closed connection → a `*.maya.ph` rule is missing.
- Checkout page renders but the captcha never appears (works on a fully-online device) → the
  per-device checkout access didn't open — no `veent-checkout:<ts>` rule for the device IP.
- GCash checkout dead-ends → the `gcash-resolve` scheduler isn't running, or `gcash-auto` hasn't
  resolved yet.
- Card payment dead-ends after entering card details → the bank ACS host is missing (see 3DS above).

---

## `--reconcile` (opt-in prune of the `veent-admin:*` family)

`setup:router --reconcile` automates the code-owned cleanup: it removes `/ip hotspot walled-garden`
**`action=allow`** rows (and tagged `walled-garden ip` rows) whose host/IP is no longer in the
desired set. As of the canonical rebuild it manages the **whole `veent-admin:*` family**, one call
per group:

```
reconcile 1: reconcileWalledGarden(config, { hosts: [], ips: [], tag: 'veent-admin:probe' })
reconcile 2: reconcileWalledGarden(config, { hosts: PAYMENT_HOSTS, ips: [], tag: 'veent-admin:payment' })
reconcile 3: reconcileWalledGarden(config, { hosts: portalHosts, ips: portalIps, tag: 'veent-admin:portal' })
```

The tag match is a **family-prefix** match (`commentMatchesTag`): a call with the bare `veent-admin`
tag would manage every `veent-admin:*` row, but each of the three real calls passes a **specific
sub-tag**, so each call only ever manages its own group's rows (no row is tagged
`veent-admin:payment:<...>`, so the prefix never leaks across siblings). The probe group's desired
set is empty — harmless, because reconcile never removes `action=deny` rows anyway.

Preview first, always:

```
bun run --filter radius-admin setup:router --reconcile --dry-run   # prints what it WOULD remove
bun run --filter radius-admin setup:router --reconcile             # actually removes them
```

It **never touches**, by construction:

- **un-tagged / manually-added operator rows** — no `veent-admin:*` tag, so they're not candidates.
- the **`action=deny` `veent-admin:probe` rows** — the action filter (`action=allow` only) excludes
  them, so a prune can't re-open a captive-probe host and bring back the flap.
- **DISABLED / DYNAMIC / empty-`dst-host`** rows (and disabled/invalid ip-layer rows) — skipped, so
  RouterOS' auto-generated `dst-address` mirrors and any deliberately-disabled row are never removal
  candidates.
- the **`gcash-auto`** `walled-garden ip` row (`gcash-auto` tag, not in the family) and the
  `/ip hotspot ip-binding` admin-bypass rows (a **different menu** that reuses the `veent-admin`
  string — `reconcileWalledGarden` only ever writes to `/ip hotspot walled-garden` and its `/ip`
  sublayer).

The default (no-flag) `setup:router` run stays **purely additive** — it never prunes anything.

---

## Audit / manual removal

```
# List everything this tooling created, by group:
/ip hotspot walled-garden print where comment~"veent-admin:"
/ip hotspot walled-garden ip print where comment~"veent-admin:"

# Remove one group by hand (rarely needed — prefer --reconcile):
/ip hotspot walled-garden remove [find where comment="veent-admin:payment"]
```
