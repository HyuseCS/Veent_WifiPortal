# Captive Portal / MikroTik Router — Outstanding Problems

> Status snapshot from the 2026-06-29 debugging session. Captures the router-side blockers that
> stop the WiFi buy-flow from working end-to-end, plus the code work that was attempted and then
> reverted. The **software is not the blocker** — the MikroTik API connection + hotspot config is.
>
> **UPDATE (post-merge, dev/admin):** the two features described below as "reverted" are **now in
> the tree** — `dev/customer` was merged in, so `activateSession` (Problem #2) and the durable
> `customer_profile.last_known_mac` column (Problem #4) are both implemented and committed. The
> "Code work attempted (REVERTED)" section and its housekeeping note are **obsolete** — see the
> rewritten section at the bottom. The **only remaining blocker is Problem #1 (router API), which
> is purely router/ops** — no application code is outstanding.

> **UPDATE (2026-06-30, network re-IP):** the hotspot network was moved off `10.0.0.0/24` to
> **`10.210.0.0/18`** — gateway/router API now `10.210.0.1`, portal/app host now `10.210.0.9`
> (was the app server `10.0.0.147` / dev-host `10.0.0.196`). The dated snapshots and captured
> log output below still show the **old** addresses on purpose (that's what was observed then);
> only the forward-looking "Operational steps remaining" list is kept current. After the move,
> restart the hotspot so its dynamic rules regenerate on the new subnet, and prune the stale
> walled-garden IP entries (see `docs/mikrotik/walled-garden.md`).

## Environment (the fact that reframed everything)

- **Router:** MikroTik **CCR1036-8G-2S+**, **RouterOS 6.49.18 (stable)**.
- **RouterOS v6 has no REST API** (`/rest/...` is v7.1+ only). Anything router-side must go over
  the **binary API** (`node-routeros`, port 8728 plain / 8729 api-ssl) — the same transport
  `grant`/`revoke`/health already use.
- **Hotspot:** server on interface `"vlan70 hotspot"`, profile `hsprof1`
  (`login-by=cookie,http-chap`, `http-cookie-lifetime=3d`, gateway `10.210.0.1`), DHCP `dhcp1`
  serving the `10.210.0.0/18` pool. App server reaches the router at
  `MIKROTIK_HOST=10.210.0.1`.

---

## The problems

### 1. The grant can't reach the router — **RESOLVED (2026-06-29): api-ssl 8729, fixed the cert**

**Root cause (isolated layer by layer from the app server 10.0.0.147):** the TLS handshake to 8729
**completes** (raw `tls.connect` ~118ms), but the router **never answered the API login over TLS** —
reproduced even with a hand-rolled RouterOS login on a raw TLS socket, so it was **not** node-routeros
and **not** the app. The `api-ssl` service was bound to cert **`api-cert-radius`**, which carries
`key-usage=key-cert-sign` (a CA cert → openssl: _"unsuitable certificate purpose"_); RouterOS completed
TLS but wouldn't serve the API over it. A proper leaf cert **`api-leaf`** (`tls-server`, no
`key-cert-sign`) already existed, unused.

**Fix:** rebound api-ssl to the leaf cert — `/ip service set api-ssl certificate=api-leaf` — after which
both the raw-TLS login AND `node-routeros` (the app's path) authenticate over 8729 (`/system/identity/print`
→ `MikroTik_Wifi_Project`). Both `.env` files are set to `MIKROTIK_PORT="8729"`, `MIKROTIK_TLS="true"`,
`MIKROTIK_TLS_INSECURE="true"` (the leaf has no IP SAN, so verification stays off — but the link is now
**encrypted**, closing the cleartext-API concern R10). **Operational step left:** restart both apps, then
test the buy-flow.

> **Bonus finding (Winbox):** the `winbox` service `address=` list ends in `10.0.0.0/32` (only the base
> address `10.0.0.0`, which no host uses) — that's why Winbox is unreachable from the router LAN while it
> works from the office ranges. Should be `10.0.0.0/24`:
> `/ip service set winbox address=206.62.40.0/22,103.62.152.0/22,103.187.245.0/24,10.0.0.0/24`

Original failure for reference — buying a tier failed to provision internet:

```
[customer] buyTier grant failed (rolled back, not charged): RosException
    at Connector.onError (.../node-routeros/dist/connector/Connector.js:176:15)
    at TLSSocket.emit (node:events:509:28)
  errno: -111            # ECONNREFUSED
```

- `errno -111` = **ECONNREFUSED**; `TLSSocket` = the app is dialing **api-ssl (8729)** and the
  router refuses the connection.
- Worked earlier in the session, then broke. Most likely cause: the **`/certificate remove`
  cleanup** (run to undo the abandoned REST/www-ssl experiment) removed the cert `api-ssl` was
  serving, so the service can't listen.
- Recommended fix: **switch to the plain `api` service (8728), no cert needed** — on a trusted LAN
  with `MIKROTIK_TLS_INSECURE=true` the TLS layer authenticates nothing anyway, so it's pure
  overhead. Set `MIKROTIK_TLS="false"`, `MIKROTIK_PORT="8728"`, `/ip service set api disabled=no`,
  **restart the app**.
- **Reported still failing after that switch** — unresolved. Need to confirm whether the error is
  _still_ `TLSSocket`/8729 (env didn't take / app not restarted) or now a plain socket refused on
  8728 (api service disabled or `address=` allowlist excludes the app server).

**Diagnostics still needed:**

```
# on the router:
/ip service print                 # is `api` enabled (no X)? port 8728? what address= filter?
# on the app server:
nc -zv 10.210.0.1 8728            # open vs refused
```

### 2. The device does not show in `/ip hotspot active` — **CODE NOW IN TREE** (blocked only by #1)

After a grant, the device gets internet (via the `ip-binding type=bypassed`) but is **never placed
in `/ip/hotspot/active`**. Consequence: some phone OSes keep showing the captive "Sign in to
network" banner for a while even though the device is already online (the post-auth captive-state
delay — "Issue 2").

- The intended fix (`activateSession`) proactively runs `/ip hotspot active login` right after the
  grant so the device lands in `/ip/hotspot/active` and the OS banner clears immediately.
- The underlying console command **was proven by hand** and works:
  ```
  /ip hotspot active login user=veent-guest password=secret ip=<device-ip> mac-address=<device-mac>
  /ip hotspot active print
  ```
  Key detail: the param is **`mac-address`**, not `mac`. On `hsprof1` (no MAC login) the login user
  must be a **real shared hotspot user** (e.g. `veent-guest`), not the device MAC.
- The automated path that calls this from the app is **blocked by Problem #1** — until the grant
  connection works, activation can't run either. **The code is now implemented and committed**
  (`mikrotik.ts` `controller.activateSession`, gated behind `MIKROTIK_HOTSPOT_USER`; wired through
  `afterBind()` in `sessions.ts`; `mac-address`/real-user details match the proven console command).
  It's a no-op until `MIKROTIK_HOTSPOT_USER` is set AND #1 is unblocked.

### 3. Fresh devices skipped the portal entirely (FIXED)

At one point a brand-new device got internet with no sign-in prompt. Root cause: **no hotspot
server existed on `vlan70`** (`/ip hotspot print` was empty), so traffic routed straight out.
Fixed by recreating it:

```
/ip hotspot add name=hotspot1 interface="vlan70 hotspot" address-pool=hs-pool-12 profile=hsprof1
/ip hotspot enable hotspot1
```

Watch for the `I` (invalid) flag → means `10.210.0.1/18` isn't on the interface.

### 4. "Device not detected" on the dashboard after a Maya payment

Credits land, but the dashboard can't identify the device, so the buyer can't spend them without
reconnecting through the portal. Two compounding causes, both **known/expected** for this topology:

- **No portal cookie** after the Maya hop — the CNA (captive mini-browser) and the system browser
  have **separate cookie jars**, so the `?mac=` cookie set at captive entry is absent on return.
- **Router IP→MAC returns null** — the hotspot **NATs client traffic to its own gateway**, so the
  app sees `10.210.0.1` (the router), not the device's `10.210.x.x`. The warning:
  ```
  [mac] unresolved — no portal cookie; router IP→MAC returned null { ip: '10.210.0.1' }
  ```
- Recovers automatically via `lastKnownMac` (the account's most recent device session) — **except**
  for an account that **topped up before ever binding a device** (no session to fall back to). That
  exact case is what produced "device not detected"; the credits are safe, and **reconnecting
  through the portal once** seeds the device and fixes it permanently.
- Robustness depends on the **hotspot login page appending `?mac=$(mac)`** when redirecting to the
  portal — confirm that's configured, or MAC capture stays fragile.

---

## Code work — NOW MERGED (the earlier "reverted" note is obsolete)

`dev/customer` was merged onto `dev/admin`, so both features that were reverted in the original
debugging session are **back in the tree and committed**:

1. **Hotspot activation (Problem #2)** — `controller.activateSession` is implemented in
   `mikrotik.ts` over the v6 binary API (`/ip/hotspot/active/login`, params `=ip=`/`=mac-address=`/
   `=user=`/`=password=`, IP resolved from the router when not supplied), **gated behind
   `config.hotspotLoginUser`** (env `MIKROTIK_HOTSPOT_USER`), and called from `afterBind()` in
   `sessions.ts`. The `activateSession?()` + `ActivateSessionInput` contract in `types.ts` is no
   longer orphaned. No-op until `MIKROTIK_HOTSPOT_USER` is set.
2. **Durable MAC persistence (Problem #4)** — `customer_profile.last_known_mac` is in the schema
   (migration `0026_superb_daredevil`), and `network-location.ts` reads/persists it and falls back
   to it when the live detector misses. The only uncovered case stays the inherent one (top-up
   before ever binding → no MAC signal at all).

**Housekeeping note is obsolete:** `0026_superb_daredevil.sql` + its snapshot are now a **legit,
committed migration** (the column is in `schema/customer.ts`), not drift. During the merge the
rate-limit-unique-index migration was renumbered to **`0027_orange_layla_miller`** to sit after it;
the full chain migrates clean from scratch (verified) and `db:generate` reports no drift.

---

## Bottom line

Problem **#1 is resolved**: api-ssl 8729 authenticates from the app server after rebinding the
service to the proper leaf cert (`api-leaf`); both `.env` files are on `8729`/`TLS=true`. Problems
**#2 and #4 are implemented in code**; #4 needs nothing further, and **#2 is now wired in `.env`**
(commented) — fill the `veent-guest` hotspot password and uncomment to enable. #3 was fixed
router-side. **No application code is outstanding.**

**Operational steps remaining (router/host, not code):**

1. **Restart both apps** so they pick up `8729`/`TLS=true` (and re-test the buy-flow grant).
2. **Re-upload `docs/mikrotik/login.html` to the router** (the repo copy is correct at
   `10.210.0.9:5173` after the 2026-06-30 re-IP; re-upload if the router's copy still points at
   an old `10.0.0.x` host).
3. *(optional)* Fix the Winbox LAN allowlist to cover the new subnet (`10.210.0.0/18`; the old
   entry was a no-op `10.0.0.0/32`, see Problem #1 box).
4. *(optional, enables #2)* set `MIKROTIK_HOTSPOT_USER`/`MIKROTIK_HOTSPOT_PASSWORD` in both `.env`.

---

## Related (application-side, not router/ops)

- **[Second account's MAC not captured](second-account-mac-not-captured.md)** — after logout, buying
  time on a *second* account doesn't grant the device internet because MAC resolution is
  browser-scoped (`veent_portal` cookie) or per-user (`last_known_mac`), and both miss for a fresh
  account. Distinct from the blockers above: this one is a customer-app logic bug, open for a later fix.
- **[CNA "Connected" flap on free time](captive-connected-flap-on-free-time.md)** — intermittent
  false "Connected" → back to "Sign in to network." Likely the walled-garden `*.google.com` /
  `*.gstatic.com` allows (needed for reCAPTCHA) also whitelisting Android's connectivity probe
  hosts, so the OS gets a real 204 pre-auth. Walled-garden/config + probe-endpoint issue, open for
  a later fix.
