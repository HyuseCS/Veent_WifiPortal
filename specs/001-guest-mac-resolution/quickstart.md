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

P1-2. On the VM, check out `fix/olt-relay-mac-resolution` at the P1 commit.

P1-3. On the VM only, make the one-line local edit in
`packages/core/src/integrations/network/types.ts` (`logMacSource`) so `ip` prints raw. The exact
`sed` command is added here by task T011. Never commit this edit. `git status` on the VM shows it as
modified. Build and restart the app the way the VM runs it.

P1-4. On the test phone, clear site data, join the guest WiFi through `OAP3000G-FC6G`, sign in. Load
the dashboard 4 times and the top-up checkout page 4 times.

P1-5. On the VM:

```sh
<app log command> | grep '\[mac-diag\]'
```

Expected: one `[mac-diag]` line per resolution, each with a `source`. Every line whose MAC ends
`80:88` names a source. Record the findings in `notes.md` (task T014).

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

P2-4. After FR-016 removal, on the VM: `grep -c '\[mac-diag\]'` on new log output returns 0 (SC-005).
