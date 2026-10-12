# Data Model: Guest MAC Resolution Behind the OLT Relay

No database schema change. No migration.

## DhcpLeaseEntry (TypeScript, `packages/core/src/integrations/network/types.ts`)

New field:

| Field    | Type                        | Rule                                                                    |
| -------- | --------------------------- | ----------------------------------------------------------------------- |
| `srcMac` | `string \| null` (optional) | RouterOS lease `src-mac-address`, UPPERCASED. Empty or absent → `null`. |

Optional so existing lease fixtures and the stub (`stub.ts`, returns `[]`) need no change.

## Relay MAC set (in memory, `packages/core/src/services/adminAccess.ts`)

- Value: `Set<string>` of UPPERCASED MACs.
- Rule: `srcMac` of every lease where `srcMac` is set, `agentCircuitId` is set (Option 82) and
  `srcMac !== mac`. Without the circuit-id test, the VM host NIC (a lease with `src-mac-address` and no
  circuit-id, notes.md "F2") would count as a relay.
- Lifetime: rebuilt at most every 5 minutes. One in-flight read is shared.
- Failure: read error, timeout (2.5 s), no `listDhcpLeases`, or a successful read with no relayed
  lease → keep the last set (empty at boot).
  Never throws.

## MAC source (log label, temporary, P1 only)

`redirect`, `portal-cookie`, `device-cookie`, `account`, `last-session`, `hotspot-host`, `lease`,
`arp`, `router-cache`, `none`.

## Existing stored values (unchanged, read through the guard)

| Store                                                 | Where                                        | P2 behavior                                                                                                            |
| ----------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `veent_portal` cookie `.mac`                          | `portal.ts`                                  | Relay value ignored on read, never written.                                                                            |
| `veent_device` cookie                                 | `portal.ts`                                  | Relay value ignored on read, never written.                                                                            |
| `customer_profile.last_known_mac`                     | `network-location.ts` `accountMac`           | Relay value ignored on read. Overwritten by the next live real MAC (`rememberAccountMac`). No manual cleanup (FR-012). |
| `network_sessions.mac_address` (latest)               | `network-location.ts` `lastKnownMac`         | Relay value ignored on read.                                                                                           |
| Admin stored device MAC                               | `apps/admin/src/lib/server/adminBypass.ts`   | `grantAdminAccess` refuses a relay MAC.                                                                                |
| `payment_checkouts.ap_circuit_id`, `ap_name_snapshot` | `packages/db/src/schema/customer.ts:267,270` | Unchanged columns. Filled from the guarded MAC (FR-016b).                                                              |
