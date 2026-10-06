# Quickstart: Guest MAC Resolution Behind the OLT Relay

The user runs the VM and the router steps. Agents do not start or stop servers and do not edit `.env`.

Test phone: Pixel 6a, real MAC `2E:47:8F:2D:35:8F`, IP `10.210.44.159`, access point `OAP3000G-FC6G`,
circuit ID `OLT-9 xpon 0/1/0/4:16.3.70`. Relay MAC `F4:B7:8D:A6:80:88`.

## Local gates (every task)

From the repo root:

```sh
bun run check
bunx prettier --check .
bunx eslint .
bun run test
bun run build
```

Admin e2e (P2, because core admin-bypass code changes), from `apps/admin/`:

```sh
bun run test:e2e
```

## P1: name the source

P1-1. Router facts (RouterOS terminal):

```
/ip dhcp-server lease print detail where address=10.210.44.159
/ip arp print where address=10.210.44.159
/ip hotspot host print where address=10.210.44.159
```

Expected: the lease shows `mac-address=2E:47:8F:2D:35:8F` and a `src-mac-address` field. Record the
exact field key and value. If the key is not `src-mac-address`, or its value is not
`F4:B7:8D:A6:80:88`, stop: P2's relay rule (research R2) needs a new plan.

P1-1b. On the live router, time a full lease print over the API (the read the relay guard makes),
for example from a machine on the router API network with the app's credentials. Record the time
in `notes.md`. If it is near or above 2.5 s, the relay-read timeout is raised in task T022.

P1-2. On the VM, undo the #115 test edit (`git checkout -- apps/customer/src/lib/server/network-location.ts`),
then fetch and check out `fix/olt-relay-mac-resolution` at the P1 commit. If GitHub HTTPS is blocked
on the VM, bring the branch over with a `git bundle` from the dev box.

P1-3. On the VM only, make the one-line local edit in
`packages/core/src/integrations/network/types.ts` (`logMacSource`) so `ip` prints raw. Never commit
this edit. `git status` on the VM shows it as modified. Then build and restart:

```sh
sed -i 's/^\(\s*\)ip: !ip ? null : v4 .*$/\1ip/' packages/core/src/integrations/network/types.ts
git diff --stat   # types.ts | 2 +- (plus the VM's own compose.prod.yaml edit)
sudo docker compose -f compose.prod.yaml build customer admin
sudo docker compose -f compose.prod.yaml up -d customer admin
```

P1-4. On the test phone, clear site data, join the guest WiFi through `OAP3000G-FC6G`, sign in. Load
the dashboard 4 times and the top-up checkout page 4 times.

P1-5. On the VM:

```sh
sudo docker compose -f compose.prod.yaml logs customer admin --since 15m 2>&1 | grep '\[mac-diag\]'
```

Expected: one `[mac-diag]` line per resolution, each with a `source`. Every line whose MAC ends
`80:88` names a source. Record the findings in `notes.md` (task T015).

## P2: guard and fix

P2-1. On the VM, drop the local edit, then update:

```sh
git checkout -- packages/core/src/integrations/network/types.ts
git pull
```

Build and restart.

P2-2. Test phone, same path as P1-4: 4 dashboard loads, 4 checkout loads, one real payment.

Expected:

- Dashboard shows a MAC ending `35:8F` on every load (SC-003).
- Checkout logs `[topup] AP resolved` with `via: 'device-circuit-id'` (SC-004).
- Latest checkout row:

```sql
select ap_circuit_id, ap_name_snapshot
from payment_checkouts
order by created_at desc
limit 1;
```

returns `OLT-9 xpon 0/1/0/4:16.3.70` and `OAP3000G-FC6G` (SC-004).

P2-3. Admin bypass (FR-013): a staff member signs in to the admin app from a device behind the OLT.
On the router:

```
/ip hotspot ip-binding print where comment~"veent-admin"
```

Expected: no row with `F4:B7:8D:A6:80:88`.

P2-4. API key proof (negative check). In a fresh browser on the test phone (no site data), open
`/dashboard?mac=F4-B7-8D-A6-80-88`.

Expected: the dashboard and the `[mac-diag]` lines do not use `80:88`, and neither the
`veent_portal` nor the `veent_device` cookie holds it. This proves the guard reads the real
`src-mac-address` key through the API.

P2-5. After FR-016 removal, on the VM: `grep -c '\[mac-diag\]'` on new log output returns 0 (SC-005).
