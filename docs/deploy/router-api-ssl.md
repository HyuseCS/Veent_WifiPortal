# Router (MikroTik) setup — api-ssl, walled garden, server moves

Shared reference for **both** deploy paths (see [`README.md`](README.md)). Both the customer and
admin apps reach the router over the RouterOS **API** (`node-routeros`). In production the API runs
encrypted on **api-ssl (8729)**; cleartext `api` (8728) is disabled so the API password never
crosses the wire in the clear (`SECURITY_RISKS.md` R10).

Router facts: gateway `10.210.0.1`, LAN `10.210.0.0/18`, API `:8728` plain / `:8729` api-ssl.

## App-side `.env` (both apps connect to the router)

```sh
MIKROTIK_HOST="10.210.0.1"      # the router's LAN IP
MIKROTIK_USER / MIKROTIK_PASSWORD
MIKROTIK_PORT="8729"
MIKROTIK_TLS="true"
MIKROTIK_TLS_INSECURE="true"    # the router cert is self-signed
```

## Router-side one-time setup

A self-signed cert attached to `api-ssl`, enabled with _Available From_ restricted to the app
server's LAN IP, and cleartext `api` turned off:

```
/certificate add name=api-cert common-name=10.210.0.1 key-usage=tls-server,key-cert-sign days-valid=3650
/certificate sign api-cert
/ip service set api-ssl certificate=api-cert address=<APP_SERVER_IP>/32 disabled=no
/ip service set api disabled=yes
/ip dhcp-server lease make-static [find address=<APP_SERVER_IP>]   # pin the server IP
```

**Pin the app server's LAN IP** (static, or a static DHCP lease) so the _Available From_
restriction can't break on a lease change.

## Walled garden + captive login page

- **Provision the walled garden** (admin host + payment domains):
  ```bash
  bun run --filter radius-admin setup:router
  ```
- **Edit the captive-portal login page** (`docs/mikrotik/login.html`) so its redirect points at the
  **production** portal URL, then upload it to the hotspot. This is the link between router and
  portal — guests can't reach the portal without it.
- **Every physical AP MAC must be `type=bypassed`** in `/ip/hotspot/ip-binding` — otherwise the
  hotspot's `hs-unauth-to` rule rejects the router's own ICMP to the AP and the dashboard reads a
  healthy AP as permanently DOWN (see [`../mikrotik/ap-liveness-bypass.md`](../mikrotik/ap-liveness-bypass.md)).
- See [`../mikrotik/admin-lan-access.md`](../mikrotik/admin-lan-access.md) for serving admin on the LAN.

## Moving the app server to another box (dev laptop → on-site VM)

The router's api-ssl _Available From_ is pinned to the OLD machine's IP, so the new server gets
`SOCKTMOUT` / connection-refused until you repoint it.

**Automated** (run from the NEW server, once it can reach the router): it detects this machine's own
source IP, restricts api-ssl to it, and pins the lease — no fat-fingered IP:

```sh
bun run --filter radius-admin setup:router --restrict-api --dry-run   # preview
bun run --filter radius-admin setup:router --restrict-api             # lock api-ssl to this server + pin lease
#   add --disable-plain-api to also turn off cleartext 8728 (needs MIKROTIK_TLS="true")
```

> **Chicken-and-egg:** if the router currently restricts api-ssl to the OLD box, the new server can't
> connect at all — temporarily **widen** the router's api-ssl _Available From_ (or open it) so the new
> server can reach it, then run the command above to re-lock it to the new IP.

**Manual equivalent** (on the router CLI):

```
/ip service set api-ssl address=<NEW_SERVER_IP>/32
/ip dhcp-server lease make-static [find address=<NEW_SERVER_IP>]
```

Either way: update `ADMIN_WG_IPS` (admin walled-garden) and re-run `setup:router` if the admin host
IP changed. The cert itself does **not** change — it's the **router's** identity (CN=10.210.0.1), not
the server's; only the allowed source IP moves. Also drop any `comment=dev-laptop` bypass from the old
box: `/ip hotspot ip-binding remove [find comment=dev-laptop]`.

## Troubleshooting

**`SOCKTMOUT` / connection refused / timeout to the router**

- The api-ssl _Available From_ is pinned to a different server IP (classic after moving boxes), or
  `MIKROTIK_PORT`/`MIKROTIK_TLS` are wrong, or the cert/api-ssl service isn't set up.
- Fix: confirm `MIKROTIK_TLS="true"`, `MIKROTIK_PORT="8729"`, `MIKROTIK_TLS_INSECURE="true"`, then
  repoint with `setup:router --restrict-api` (or manual `/ip service set api-ssl address=<this-server>/32`).
  If you've locked yourself out, temporarily widen the router's api-ssl _Available From_, then re-lock.

**Router cert: `failure: CA not found` when signing the api-ssl cert**

- A `tls-server`-only cert can't self-sign. Create it with `key-usage=tls-server,key-cert-sign`, then `sign`.

**Networks page suddenly shows no health / latency stuck at `—` (was working before)**

- Almost always the app server's IP **drifted off** the IP pinned in the api-ssl _Available From_
  restriction (a DHCP lease change). api-ssl then silently drops the SYN, so node-routeros hangs to its
  timeout and the health sweep gets nothing — and **no error is logged**. Plain `api` (8728) may still
  appear to work, masking it.
- Confirm from the app server: `openssl s_client -connect <router>:8729 -brief </dev/null` should say
  `CONNECTION ESTABLISHED` in ~100ms. If it hangs, the restriction is blocking this IP.
- Fix: **pin the app server to a static DHCP lease** on the router (durable fix), then re-point the
  restriction — `/ip service set api-ssl address=<this-server>/32` (or `setup:router --restrict-api`).
- Separately, if `/ping`-based **latency** stays `—` but health is otherwise fine, the router API
  user's group is missing the **`test`** policy (RouterOS gates `/ping` behind it):
  `/user group set [find name=<group>] policy=...,test` (append `test`, don't drop the others).

**Guests connect to WiFi but never see the portal**

- The router `login.html` doesn't point at the prod portal URL (or wasn't uploaded). Edit
  `docs/mikrotik/login.html` → upload to the hotspot.

**Maya checkout shows a closed connection / can't load**

- The hotspot walled garden doesn't allow the Maya domains — run `bun run --filter radius-admin setup:router`.
  (Card 3-D Secure may still need the issuing bank's ACS domain added per deployment.)

**Your operator/dev machine lost internet after its purchased time expired**

- Expected: the revoke cron drops an expired guest bypass. Give the operator box a **standing** bypass:
  `/ip hotspot ip-binding add mac-address=<MAC> type=bypassed comment=dev-laptop`
  (the cron only touches `veent-portal`-tagged guest bindings).
