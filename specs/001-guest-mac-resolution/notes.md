# Notes: guest MAC resolution (GH #114)

## P1 phone test, 2026-10-06 (staged VM, branch at 18379a6 plus the local full-IP edit)

Test phone: Pixel-6a, MAC `2E:47:8F:2D:35:8F`, IP `10.210.44.159`, through `OAP3000G-FC6G`. Site data
cleared, then 4 dashboard loads and 4 checkout loads.

`[mac-diag]` lines (9):

```
[mac-diag] { source: 'redirect', mac: '**:**:**:**:35:8F', ip: '10.210.0.1' }   x8
[mac-diag] { source: 'account',  mac: '**:**:**:**:35:8F', ip: '10.210.0.1' }   x1
```

- Every line has the real MAC. `80:88` did not appear, so its source is not named by this run.
- The client IP is always `10.210.0.1` (router srcnat), so the router IP→MAC lookup can never
  identify a guest. The captive redirect `?mac=` is the only live source that works.
- The account MAC is now `35:8F`; the earlier relay MAC on that row was overwritten by a live
  resolution.

Checkout in the same run:

```
[topup] AP resolved { via: 'device-circuit-id', mac: '**:**:**:**:35:8F',
  circuitId: 'OLT-9 xpon 0/1/0/4:16.3.70', networkId: 4 }
payment_checkouts: settled | 4 | OLT-9 xpon 0/1/0/4:16.3.70 | OAP3000G-FC6G | 2026-10-06 07:14:21Z
```

SC-004 met; GH #97 closed with this evidence.

## Earlier runs the same day (VM on old `main` + #115 one-line edit)

- `[dash-load] mac=…80:88 live=true` in 3 of 4 loads, checkout `via: 'device-mac'` with `80:88`, no
  `[mac] unresolved` warning. `live=true` with client IP `10.210.0.1` (lookup returns null) means
  the MAC came from the portal cookie, which is filled from `?mac=`.
- Router facts: `F4:B7:8D:A6:80:88` is the `src-mac-address` on every relayed lease (OLT relay) and
  the ARP MAC for relayed IPs such as `10.210.44.157`.

## Open

- Where `80:88` entered the portal cookie is not proven. Most likely an earlier `?mac=` redirect
  carried the relay MAC, or an older cookie survived. The P2 guard covers every source either way.

## Reproduction attempt and checkpoint, 2026-10-06

- About 10 rounds on the Pixel: captive page path, Chrome path (`http://neverssl.com` redirect),
  Wi-Fi off/on without forgetting, and 5+ minute idle returns. No `80:88` in `[mac-diag]`.
- A Chrome redirect read on the phone carried the real MAC:
  `?mac=2E:47:8F:2D:35:8F&ip=10.210.44.159&…&ssid=$(ssid)` (`$(ssid)` is not filled by the router;
  unrelated).
- Decision (user): build P2 now. FR-014 has no named source, so no source fix is made; the relay-MAC
  guard covers every source. T027 and T028 are closed as not needed.

## T013: relay-list read time, 2026-10-06

Full `/ip/dhcp-server/lease/print` over the API from the VM admin container (node-routeros), 3 runs:
13 leases in 90 ms, 48 ms, 45 ms. The API key `src-mac-address` returns `F4:B7:8D:A6:80:88`. The
2.5 s relay-read timeout stays.

## T029: P2 live test, 2026-10-12 (VM at 9333699, no local edits)

P2-2, test phone through `OAP3000G-FC6G`: dashboard and checkout loads, one real payment. Pass.

- 15 `[mac-diag]` lines (sources `redirect` and `account`). Every MAC ends `35:8F`, none `80:88`
  (SC-003).
- `[topup] AP resolved { via: 'device-circuit-id', circuitId: 'OLT-9 xpon 0/1/0/4:16.3.70',
networkId: 4 }`, then `[webhook] paid { credited: true }` (SC-004).
- Latest `payment_checkouts` row: `OLT-9 xpon 0/1/0/4:16.3.70`, `OAP3000G-FC6G` (SC-004).

P2-3, admin sign-in with 2FA from the test phone through `OAP3000G-FC6G`. Pass (FR-013).

- First try: `admin bypass skipped — no MAC for client ip=10.210.0.1`. The router NAT exemption
  `no-nat-admin-port` pointed at the old dev box (`10.210.62.191:5174`), so hotspot masquerade hid
  the client IP. Fix (router, user): new rule `no-nat-admin-vm`, `chain=srcnat action=accept
protocol=tcp dst-address=10.210.54.133 dst-port=3002`, placed before `masquerade hotspot network`.
  The old rule is kept.
- Second try: `admin bypass granted: ip=10.210.41.240 mac=2E:47:8F:2D:35:8F`.
- `admin_bypass_device`: one row, MAC `2E:47:8F:2D:35:8F`.
- `/ip hotspot ip-binding print where comment~"veent-admin"`: one bypassed row,
  `2E:47:8F:2D:35:8F`. No row with `F4:B7:8D:A6:80:88`.

P2-4, fresh Firefox private window on the guest Wi-Fi, `/dashboard?mac=F4-B7-8D-A6-80-88`.

- `[mac-diag]`: `hotspot-host` then `router-cache`, both `**:35:8F`. No `redirect` line, so the
  relay MAC from `?mac=` was dropped and the router IP lookup gave the real MAC. This proves the guard
  reads `src-mac-address` through the live API.
- Dashboard device list: "This device" shows `··2D:35:8F`, no row shows `··A6:80:88`. Pass.
- Cookie check not done: the test ran on the phone, which has no simple cookie view. Covered by
  `portal.spec.ts` (a relay `?mac=` sets no cookie) and by the missing `redirect` source above.
- Open: the customer app saw the real client IP here (the router lookup hit), but in P1 it always
  saw `10.210.0.1`. The new `no-nat-admin-vm` rule covers port 3002 only. Not explained yet.
  Hypothesis, not confirmed: during P2-4 the phone still had the admin bypass from P2-3
  (ip-binding type=bypassed), so its traffic likely skipped the hotspot path. The P2-4 result does not
  depend on it: no `redirect` source line means the relay `?mac=` was dropped.

## F2 (US2 review): which leases carry `src-mac-address`, 2026-10-12

`/ip dhcp-server lease print detail where src-mac-address!=""` gave 8 rows. The ones where
`src-mac-address` differs from `mac-address`:

- #2 `AP-Pabayo` (`OAP3000G-FC6G`), #6 `HyuseTP`, #7 `Pixel-6a`: `src-mac-address=F4:B7:8D:A6:80:88`,
  each with `agent-circuit-id="OLT-9 xpon 0/1/0/4:16.3.70"`.
- #3 `RADServer-Headend` (the VM, `10.210.54.133`, `00:15:5D:DD:79:05`):
  `src-mac-address=02:00:00:00:00:B2`, no `agent-circuit-id`. This is the VM host's NIC, not a relay,
  but the current rule (`srcMac && srcMac !== mac`) puts it in the relay set.
- The other rows print no `src-mac-address`.

## R1 (second US2 review): circuit-id after renewal, 2026-10-12

Same lease print about 34 min after the F2 print. Lease time is 1 h, so renewals come about every
30 min. All 3 OLT leases renewed between the prints (last-seen: #2 14m02s -> 17m38s, #6 13m26s ->
17m03s, #7 25m40s -> 6m47s) and each still has `src-mac-address=F4:B7:8D:A6:80:88` plus
`agent-circuit-id="OLT-9 xpon 0/1/0/4:16.3.70"`. No relayed lease without a circuit-id, so the
Option 82 rule (cc9e475) needs no fallback. Limit: the print cannot show whether RouterOS keeps an
old circuit-id value on a renewal.

## T031: final gates and P2-5, 2026-10-12

- Local gates on 7fac722: check 0 errors (3 apps); unit tests core 141, customer 159, admin 167,
  locator 6; build (all apps); admin e2e 23/23 (throwaway `radius_admin_test` DB). Dummy env values
  in the shell only, no `.env` file.
- VM at 7fac722 (bundle, build, restart). Test phone loaded the dashboard; it shows `··2D:35:8F`.
  `logs customer admin --since 10m | grep -c '\[mac-diag\]'` returns `0` (SC-005).
