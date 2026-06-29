# MikroTik Hotspot Activation Runbook (Issue 2 — captive-state delay)

> ✅ **Verified against live hardware: MikroTik CCR1036, RouterOS 6.49.18 (2026-06-29).**
> The underlying `/ip hotspot active login` command was proven by hand on the router console and
> places a `type=bypassed` device into `/ip/hotspot/active`. Activation runs over the **binary
> API** (the same transport as grant/revoke) because **RouterOS v6 has no REST API** (`/rest/...`
> is v7.1+ only).

## The problem

When a guest authenticates, `grant()` writes an `/ip/hotspot/ip-binding type=bypassed` for the
device MAC. That lets traffic through, but the device is **never placed in
`/ip/hotspot/active`**. Some phone OSes keep showing the Captive Network Assistant ("Sign in to
network") until their next probe happens to succeed — so the guest sees a stale sign-in screen
for a while even though they're already online.

`activateSession()` fixes the UX by **proactively logging the device into the hotspot** right
after the grant commits (`/ip/hotspot/active/login`), so it appears in `/ip/hotspot/active`
immediately and the OS captive check flips to "connected".

- Code: `activateSession` in `packages/core/src/integrations/network/mikrotik.ts`
- Driven from: the shared post-commit hook `afterBind()` in
  `packages/core/src/services/sessions.ts` — so **every** grant path (free time, paid tier,
  reconnect/bind, admin comp) activates through one place.
- Transport: the **binary API** (`node-routeros`, port 8728/8729) — the same connection
  grant/revoke already use. No REST, no `www-ssl`, no certificates.

## Configuration

Activation is **opt-in via `MIKROTIK_HOTSPOT_USER`**. When it's set, the controller exposes
`activateSession`; when blank, activation is simply unavailable (grant/revoke still work — the OS
captive banner just clears a little slower).

| Env | Required? | Meaning |
|---|---|---|
| `MIKROTIK_HOTSPOT_USER` | optional | The hotspot user to log the device in as. **Must be a real user on the guest hotspot profile.** Setting it enables activation. |
| `MIKROTIK_HOTSPOT_PASSWORD` | optional | That user's password. |

There is **no** `MIKROTIK_REST_URL`. Activation reuses the existing
`MIKROTIK_HOST`/`MIKROTIK_USER`/`MIKROTIK_PASSWORD`/`MIKROTIK_PORT`/`MIKROTIK_TLS` binary-API
connection. Access time is **not** mapped to a hotspot session-timeout — it stays enforced by the
DB access window + the revoke cron, exactly as for grant/revoke.

> ⚠️ The guest profile on this deployment (`hsprof1`) is `login-by=cookie,http-chap`, which has
> **no MAC login**. So `MIKROTIK_HOTSPOT_USER` must name a real shared user (e.g. `veent-guest`) —
> the "user = device MAC, empty password" shortcut only works on a `login-by=mac-cookie`/`mac`
> profile and does **not** apply here.

## Router prerequisites

1. **A hotspot server must exist on the guest VLAN.** This is the thing that intercepts
   unauthenticated traffic and shows the portal. Without it, devices get a DHCP lease and route
   straight to the internet (no sign-in prompt at all). On this deployment:

   ```
   /ip hotspot print          # must list a server on `vlan70 hotspot`, profile hsprof1, no X/I flag
   ```

   If it's missing, recreate it (the DHCP server + `hs-pool-12` pool + `hsprof1` profile survive
   independently of the server):

   ```
   /ip hotspot add name=hotspot1 interface="vlan70 hotspot" address-pool=hs-pool-12 profile=hsprof1
   /ip hotspot enable hotspot1
   ```

   If it shows the `I` (invalid) flag after enabling, the profile's gateway IP isn't on the
   interface — confirm `/ip address print where interface="vlan70 hotspot"` has `10.0.0.1/24`.

2. **A shared hotspot user for activation.** Create the user named in `MIKROTIK_HOTSPOT_USER`,
   ideally on a profile that allows concurrent logins so one user can back many devices:

   ```
   /ip hotspot user profile add name=veent-activate shared-users=unlimited \
     session-timeout=0 idle-timeout=none keepalive-timeout=none
   /ip hotspot user add name=veent-guest password=secret profile=veent-activate
   ```

3. **The binary API service** (`/ip service` → `api` or `api-ssl`) must be enabled and reachable
   from the app server — it already is, since grant/revoke work. Activation needs nothing more.

## How to verify

With `MIKROTIK_HOTSPOT_USER`/`PASSWORD` set, grant a device (free time or a tier) and watch the
router:

```
# The device should appear here within a second or two of the grant:
/ip hotspot active print

# Confirm the bypass binding is still present (activation is ON TOP of it, not instead):
/ip hotspot ip-binding print where comment=veent-portal
```

App-side, a failed activation logs (and is swallowed) in the customer app's terminal:

```
[sessions] activateSession failed (access still granted): <reason>
```

Common reasons:
- **`invalid user name or password`** → `MIKROTIK_HOTSPOT_USER`/`PASSWORD` don't match a hotspot
  user on the profile.
- **no log line at all, device not in active** → activation isn't firing: `MIKROTIK_HOTSPOT_USER`
  is unset (so `activateSession` isn't attached), or the device's IP couldn't be resolved yet.

You can prove the underlying command by hand on the router console (this is exactly what the code
runs over the API):

```
/ip hotspot active login user=veent-guest password=secret ip=<device-ip> mac-address=<device-mac>
/ip hotspot active print
```

## Returning devices skip the portal — by design

Several layers can put a device online without a fresh sign-in; none is a bug:

- **The durable bypass binding.** `grant()` writes a `type=bypassed` ip-binding that persists
  across reconnects until the revoke cron removes it (when the guest's time/credits expire). Any
  reconnect by that MAC gets internet with no portal until then. (Clearing it for a re-test:
  `/ip hotspot ip-binding remove [find where comment="veent-portal"]`.)
- **The app's dashboard auto-bind** (`apps/customer/.../dashboard/+page.server.ts`). A still-
  logged-in browser with live account time re-binds + re-grants on load — zero taps.
- **`hsprof1` has `login-by=cookie` + `http-cookie-lifetime=3d`** — once a device signs in, the
  router auto-logs it in for 3 days on reconnect. (Clear with `/ip hotspot cookie remove [find]`.)

To force a true first-time "must sign in" test: use a device that has never authenticated, **or**
log out in the portal browser AND remove the device's `ip-binding` / `cookie` on the router, then
reconnect.

## If activation misbehaves

Activation can never strand a guest — it runs **after** the grant commits and any error is
caught. To disable it entirely, **unset `MIKROTIK_HOTSPOT_USER`** and restart the app; grant/revoke
and the existing host-flush (which already mitigates most of the captive delay) keep working
unchanged.
