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
