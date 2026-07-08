# Admin bypass on a real router — troubleshooting

Bring-up notes for the **admin-device bypass** (`veent-admin` ip-binding, B3.2) against a live
MikroTik. Written during the first real-router bring-up on `dev/audit-fixes`; the flow now works
and is bench-verified.

**Status**
- ✅ **SOLVED:** device MAC resolves on admin login → `veent-admin:<epoch>` binding is written and
  appears in Winbox (IP → Hotspot → IP Bindings).
- ✅ **RESOLVED:** the earlier "shows the binding but has **no internet**" report was the OS **"!"
  connectivity-check indicator** — the device is genuinely online; browsing works. See the "!"
  section below. A fresh grant now also cuts conntrack, so the bypass is fast within seconds.

---

## Symptom (solved part)

Signing into the admin dashboard from a hotspot device did **not** create a `veent-admin`
ip-binding — only a *customer* plan purchase (which yields a `veent-portal` binding) ever showed up.

## Root causes — three stacked, all IP/config drift

The admin bypass, unlike the customer flow, has **no captive-portal `?mac=`** — it resolves the
device MAC from the client's source IP via the router API (`resolveMacByIp`). Every link in that
chain was broken:

1. **IPv4-mapped IPv6 not stripped.** `event.getClientAddress()` on a dual-stack Node listener
   returns `::ffff:10.x.x.x`; RouterOS stores plain IPv4, so `?address=::ffff:…` missed.
   → **Fix (code):** strip `^::ffff:` in `resolveDeviceMac` (`packages/core/src/services/adminAccess.ts`).
   Customer path was immune — it strips at its own call sites.

2. **Hotspot masquerade hid the client IP.** `/ip firewall nat` rule
   `masquerade hotspot network` (`chain=srcnat action=masquerade src-address=10.210.0.0/18`)
   rewrites every hotspot client's source to the gateway (`10.210.0.1`), so the app saw the gateway
   instead of the phone. An exemption existed (`comment=no-nat-admin-port`) but was pinned to a
   **stale app-box IP**.
   → **Fix (router):** point the exemption at the app box's current IP:
   `/ip firewall nat set [find comment="no-nat-admin-port"] dst-address=<app-box-ip>`

3. **Admin `.env` pointed at a dead router address.** `MIKROTIK_HOST="10.0.0.1"` — unroutable from
   the app box — so **every** router call timed out (→ `resolveMacByIp` caught the timeout and
   returned null → "skipped, no MAC"). The **customer** `.env` correctly used `10.210.0.1:8729/TLS`.
   This was the real blocker; #1/#2 just had to be cleared to see it.
   → **Fix (config):** match the customer — `MIKROTIK_HOST="10.210.0.1"`, `MIKROTIK_PORT="8729"`,
   `MIKROTIK_TLS="true"`, `MIKROTIK_TLS_INSECURE="true"`. Restart the app (env is read at startup).

## Diagnostic method (reuse this)

1. **Tail the admin log on a fresh login** (`journalctl -u radius-admin -f`, or the dev-server
   terminal). The `postLogin` diagnostic prints one of:
   - `admin bypass granted: ip=… mac=…` → grant fired.
   - `admin bypass skipped — no MAC for client ip=<X>` → read `<X>`:
     - `<X>` = gateway (`10.210.0.1`) → **masquerade** (cause 2).
     - `<X>` = the phone's real IP but still skipped → router unreachable / wrong host (cause 3),
       or the IP genuinely isn't in the router tables.
2. **Test router API reachability from the app box:** `bash -c 'echo > /dev/tcp/<MIKROTIK_HOST>/<port>'`.
   If it times out, the app can't reach the router at all → cause 3 (or a firewall/API allow-list).
3. **Confirm IP→MAC on the router:** `/ip hotspot host print where address=<ip>`,
   `/ip dhcp-server lease print where address=<ip>`, `/ip arp print where address=<ip>`.
   `resolveMacByIp` tries host → lease → arp, so a lease/arp hit is enough.
4. **Confirm the binding:** `/ip hotspot ip-binding print` → look for `type=bypassed`,
   `comment=veent-admin:<epoch>`.

## Durability — the app box is a DHCP Wi-Fi client

The app box (`wlan0`) joins the hotspot and gets a **dynamic** lease, so its IP drifts. When it
drifts, the masquerade exemption, `ORIGIN`, and the walled-garden allow all go stale (this is how we
got into this mess — three different stale IPs for one box). To stop the churn:

1. **Pin the lease static:** `/ip dhcp-server lease make-static [find address="<app-box-ip>"]`.
2. Keep `ORIGIN`, the `no-nat-admin-port` exemption, and the walled-garden IP allow all pointed at
   that one pinned IP.
3. Delete stale references left from previous IPs (old walled-garden `veent-admin` allow, old
   exemption dst).

> **MAC randomization:** the device MAC seen here was locally-administered (randomized, e.g.
> `2E:E3:…`). If the phone rotates its private MAC, the `veent-admin` binding (keyed to the old MAC)
> goes stale on reconnect → set the phone's Wi-Fi to a **fixed/device MAC** for this SSID, or accept
> that each new MAC needs a fresh login to re-grant.

---

## Confirmed end-to-end — with caveats

A present `veent-admin` bypass binding **does** give the device internet. The automatic flow works:
login → `resolveMacByIp(clientIP)` → grant → `veent-admin:<epoch>` binding. Confirmed on the bench
(`admin bypass granted: ip=… mac=…` in the log, binding visible in Winbox, device online).

> **A hand-added binding is a diagnostic, not the flow.** During bring-up we added a binding by hand
> (`/ip hotspot ip-binding add mac-address=<mac> type=bypassed comment=veent-admin-test`) only to
> prove the bypass→internet path independently of the app. The app grants automatically on login —
> you do **not** need to add bindings manually. (Clean up any test binding afterward.)

### Caveat A — logout revokes the bypass (by design)
Signing out fires `revokeAdminBypass` → the `veent-admin` binding is removed and the device drops to
walled-garden-only. So a device only keeps internet **while the staff member is signed in** (slid
forward on activity, reaped at the 4h TTL). If you're testing and the binding "disappears," you
logged out.

### Caveat B — MAC resolution at login can transiently miss (mitigated by retry)
Because the admin path has no `?mac=`, it does a live IP→MAC lookup at the instant of login. That can
transiently miss (router-API latency, or the device mid-reconnect so it's briefly absent from the
hotspot host/lease tables). **Mitigated:** `resolveDeviceMac` now *retries* the live lookup (3 attempts
× 2.5 s + ~300 ms backoff, ~8 s worst case) and keeps an age-bounded stale-cache fallback, so a
transient timeout/empty usually converts into the grant it should have been (`packages/core/src/services/adminAccess.ts`,
commit 8116b11). If every attempt still misses, that login grants nothing (`skipped — no MAC for
client ip=…`) and the next dashboard load (the sliding refresh) grants it once the device is visible.
The DHCP lease is the durable fallback, so a stably-connected device resolves reliably.

### Caveat C — the sliding-refresh retry (FIXED)
`refreshAdminBypass` (the `(app)` layout retry that should re-grant on each dashboard load, sliding the
4h window and papering over a Caveat-B miss) used to call `event.getClientAddress()`, which throws
**`Could not determine clientAddress`** in the layout-load context (SvelteKit `__data.json`
sub-requests) → the slide never ran. **Fixed:** the login-resolved MAC is persisted in a durable
server-side store keyed by the better-auth **session token** — the `admin_bypass_device` table
(`postLogin.ts` → `rememberAdminDevice`). The renewal and logout read the MAC back from that store via
`event.locals.session.token` — no `getClientAddress()`, no re-lookup (`adminBypass.ts`). Logout revokes
that MAC and deletes the row (the row also FK-cascades away when the session ends). This replaced an
earlier signed httpOnly `admin_dev_mac` cookie, which didn't reliably survive the login form-action
through to logout (commit 8116b11); the store is per-session, so two devices get two rows, each revoked
independently on its own sign-out. _Verify on bench: stay signed in past the refresh interval, confirm
the binding's epoch advances._

### Slowness after grant (FIXED)
Fresh bypass, snail-slow browsing for a bit: the device's **existing** connections keep riding the
pre-bypass (hotspot-intercepted) path until they age out of conntrack. **Fixed:** grant now cuts the
device's conntrack on a fresh bypass (`flush=true`), mirroring what *revoke* already does, so open
flows re-evaluate against the bypass at once — fast in seconds, not a minute (`mikrotik.ts` `grant()`).
It only fires on the non-bypassed→bypassed transition, so sliding renewals / repeat grants never poke a
live device. (A hand-added binding skips this entirely, so it's the *slowest* path — don't judge settle
time by it.) _Verify on bench: a fresh login-grant should browse fast within seconds._

### The Wi-Fi "!" (no-internet) warning while internet actually works — EXPECTED
A bypassed device can show the OS **"!" / "No internet"** indicator even though browsing (YouTube,
sites) works fine. Not a bypass fault. The hotspot's walled-garden explicitly **denies the OS
connectivity-check probe hosts** — `connectivitycheck.android.com`, `connectivitycheck.gstatic.com`,
`www.google.com/generate_204`, `captive.apple.com`, `www.msftconnecttest.com`,
`detectportal.firefox.com`, `clients1-4.google.com` (11 rules, `comment=veent-admin`, added by
`provisionWalledGarden`). Those denies exist on purpose to stop the guest "flashes Connected then
reverts" flap (`docs/problems/captive-connected-flap-on-free-time.md`). Side effect: the OS probe
gets no `204` → the device shows "!" even when fully bypassed. Traffic to any non-denied host flows
normally (that's why a video plays). Compounded by the uplink — measured **~1.1 Mbps** on the bench
ONU (68 ms latency, 0% loss), which alone can time the probe out. **Leave the denies** (removing them
reintroduces the guest flap); the "!" is cosmetic. Only revisit if a specific app hard-gates on the OS
connectivity check and refuses to run — that'd need a targeted per-device carve-out.

_Both code follow-ups are implemented (Caveat C session-keyed device store + cut-conntrack-on-grant)
and bench-verified._
