# Contract: Core MAC Guard and Diagnostic Log

Internal contracts in `@veent/core`. Both apps use them only through `@veent/core`.

## `dropRelayMac(network, mac)` (P2, permanent)

File: `packages/core/src/services/adminAccess.ts`

```ts
export async function dropRelayMac(
	network: NetworkController,
	mac: string | null | undefined
): Promise<string | null>;
```

- Returns `null` when `mac` is empty or is in the relay MAC set (case-insensitive).
- Else returns `mac` unchanged.
- Never throws. Relay set rules: see `../data-model.md`.

## `resolveDeviceMac(network, ip)` (changed)

- New: a router result that is a relay MAC returns `null` at once. It is not retried and not cached.
- Unchanged: IPv4-mapped prefix strip, 60 s cache, 3 attempts, 5 min stale bound.

## `grantAdminAccess(network, mac)` (changed)

- New: a relay MAC returns without calling `network.grant`.

## `NetworkController.listDhcpLeases()` (changed)

- Each `DhcpLeaseEntry` may carry `srcMac` (RouterOS `src-mac-address`, uppercased, empty → null).

## `logMacSource(source, mac, ip)` (P1, temporary, removed in P2 by FR-016)

File: `packages/core/src/integrations/network/types.ts`

```ts
export function logMacSource(source: string, mac: string | null, ip: string | null): void;
```

- Writes one line: `console.info('[mac-diag]', { source, mac, ip })`.
- `mac`: last two octets visible (`**:**:**:**:80:88`), same rule as customer `maskMac`.
- `ip` in the committed code: masked like customer `maskIp` (IPv4 keeps `/16`).
- `ip` on the staged VM only: raw, through one uncommitted local edit (`../quickstart.md` step P1-3).
- Source names: see `../data-model.md`.
