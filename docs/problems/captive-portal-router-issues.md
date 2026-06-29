# Captive Portal / MikroTik Router — Outstanding Problems

> Status snapshot from the 2026-06-29 debugging session. Captures the router-side blockers that
> stop the WiFi buy-flow from working end-to-end, plus the code work that was attempted and then
> reverted. The **software is not the blocker** — the MikroTik API connection + hotspot config is.

## Environment (the fact that reframed everything)

- **Router:** MikroTik **CCR1036-8G-2S+**, **RouterOS 6.49.18 (stable)**.
- **RouterOS v6 has no REST API** (`/rest/...` is v7.1+ only). Anything router-side must go over
  the **binary API** (`node-routeros`, port 8728 plain / 8729 api-ssl) — the same transport
  `grant`/`revoke`/health already use.
- **Hotspot:** server on interface `"vlan70 hotspot"`, profile `hsprof1`
  (`login-by=cookie,http-chap`, `http-cookie-lifetime=3d`, gateway `10.0.0.1`), DHCP `dhcp1`
  serving pool `hs-pool-12` (`10.0.0.10–10.0.0.254`). App server reaches the router at
  `MIKROTIK_HOST=10.0.0.1`.

---

## The problems

### 1. The grant can't reach the router — **CURRENT PRIMARY BLOCKER**

Buying a tier fails to provision internet:

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
  *still* `TLSSocket`/8729 (env didn't take / app not restarted) or now a plain socket refused on
  8728 (api service disabled or `address=` allowlist excludes the app server).

**Diagnostics still needed:**
```
# on the router:
/ip service print                 # is `api` enabled (no X)? port 8728? what address= filter?
# on the app server:
nc -zv 10.0.0.1 8728              # open vs refused
```

### 2. The device does not show in `/ip hotspot active`

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
  connection works, activation can't run either (and the code for it is currently reverted, see
  "Code attempted" below).

### 3. Fresh devices skipped the portal entirely (FIXED)

At one point a brand-new device got internet with no sign-in prompt. Root cause: **no hotspot
server existed on `vlan70`** (`/ip hotspot print` was empty), so traffic routed straight out.
Fixed by recreating it:
```
/ip hotspot add name=hotspot1 interface="vlan70 hotspot" address-pool=hs-pool-12 profile=hsprof1
/ip hotspot enable hotspot1
```
Watch for the `I` (invalid) flag → means `10.0.0.1/24` isn't on the interface.

### 4. "Device not detected" on the dashboard after a Maya payment

Credits land, but the dashboard can't identify the device, so the buyer can't spend them without
reconnecting through the portal. Two compounding causes, both **known/expected** for this topology:

- **No portal cookie** after the Maya hop — the CNA (captive mini-browser) and the system browser
  have **separate cookie jars**, so the `?mac=` cookie set at captive entry is absent on return.
- **Router IP→MAC returns null** — the hotspot **NATs client traffic to its own gateway**, so the
  app sees `10.0.0.1` (the router), not the device's `10.0.0.x`. The warning:
  ```
  [mac] unresolved — no portal cookie; router IP→MAC returned null { ip: '10.0.0.1' }
  ```
- Recovers automatically via `lastKnownMac` (the account's most recent device session) — **except**
  for an account that **topped up before ever binding a device** (no session to fall back to). That
  exact case is what produced "device not detected"; the credits are safe, and **reconnecting
  through the portal once** seeds the device and fixes it permanently.
- Robustness depends on the **hotspot login page appending `?mac=$(mac)`** when redirecting to the
  portal — confirm that's configured, or MAC capture stays fragile.

---

## Code work attempted this session (currently REVERTED)

Both were built, verified (typecheck + tests green), then rolled back via `git reset --hard` to the
last commit. The **implementations are not in the tree** now (verified on `dev/customer`, HEAD
`0b83f24`):

1. **Issue 2a hotspot activation** rebuilt over the v6 binary API (`/ip/hotspot/active/login`),
   opt-in via `MIKROTIK_HOTSPOT_USER`, wired through the shared `afterBind()` hook. **Implementation
   reverted** (`mikrotik.ts`, `sessions.ts`, env wiring all gone). **Caveat:** the *contract* —
   `activateSession?()` + `ActivateSessionInput` in `types.ts` — is still present because it was
   committed in `0b83f24`; it's now an **orphaned interface member** (nothing implements or calls
   it). Either delete it or keep it as a placeholder for a future rebuild.
2. **Durable MAC persistence** — a `customer_profile.last_known_mac` column (keyed by user, not a
   cookie) to bridge the Maya cross-browser gap (Problem #4). **Fully reverted** (not in the schema).

**Housekeeping:** the reset left two **orphaned untracked files** for the reverted MAC column —
`packages/db/drizzle/0026_superb_daredevil.sql` and `packages/db/drizzle/meta/0026_snapshot.json`.
The column they add (`last_known_mac`) is no longer in `schema/customer.ts`, so this is migration
**drift** — delete both files (and drop the column from the dev DB if `db:migrate` already applied
it) unless the MAC-persistence feature is going to be re-added.

---

## Bottom line

The blocker is **not the application code** — it's the **MikroTik API connection (Problem #1)**.
The buy-flow needs one open, reachable API port. Plain `api`/8728 is the simplest path; the open
question is why it still refuses after the switch, which the `/ip service print` + `nc` outputs
above will answer. Problem #2 (device not in `/ip hotspot active`) is a UX-polish layer that only
matters once #1 works.
