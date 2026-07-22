import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * M-1 / L-1 — `resolveMacTrusted` returns ONLY the server-resolved MAC and fires a tamper tripwire
 * (masked, userId-only) when a caller's advisory `claimedMac` disagrees. This is the shared seam behind
 * the grant endpoint and the dashboard grant actions, so the tripwire behaviour is asserted once here.
 */

vi.mock('$app/environment', () => ({ dev: false }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));
// A configurable db mock: update() resolves (rememberAccountMac); select() returns a chainable
// stub whose terminal await shifts one result off `selectQueue`, so a test drives each query's
// result in order regardless of which table/columns it selects.
const selectQueue: unknown[][] = [];
function resetDb() {
	selectQueue.length = 0;
}
vi.mock('$lib/server/db', () => {
	const chain: Record<string, unknown> = {};
	for (const m of ['select', 'from', 'where', 'orderBy']) chain[m] = () => chain;
	chain.limit = () => Promise.resolve(selectQueue.shift() ?? []);
	return {
		db: {
			update: () => ({ set: () => ({ where: async () => {} }) }),
			select: () => chain
		}
	};
});
vi.mock('$lib/server/network', () => ({ network: {} }));
vi.mock('$lib/server/portal', () => ({
	getPortalContext: vi.fn(),
	getDeviceMac: vi.fn(),
	persistResolvedMac: vi.fn()
}));
vi.mock('@veent/core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@veent/core')>();
	return { ...actual, captureHandled: vi.fn(), resolveNetworkIdByApName: vi.fn() };
});

import { resolveMacTrusted, resolveCheckoutLocation } from './network-location';
import { getPortalContext } from '$lib/server/portal';
import { captureHandled, resolveNetworkIdByApName } from '@veent/core';

const SERVER_MAC = 'AA:BB:CC:DD:EE:01';
const evt = { getClientAddress: () => '10.0.0.5' } as never;

describe('resolveMacTrusted — server-authoritative MAC + tamper tripwire (M-1/L-1)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Portal cookie carries the real device MAC — resolveMac returns it directly (no IP→MAC needed).
		(getPortalContext as ReturnType<typeof vi.fn>).mockReturnValue({ mac: SERVER_MAC });
	});

	it('returns the server MAC and logs a tripwire when the claimed MAC differs', async () => {
		const mac = await resolveMacTrusted(evt, 'u1', 'BB:BB:BB:BB:BB:BB');
		expect(mac).toBe(SERVER_MAC);
		expect(captureHandled).toHaveBeenCalledTimes(1);
	});

	it('does not log when the claimed MAC matches (case-insensitively)', async () => {
		const mac = await resolveMacTrusted(evt, 'u1', SERVER_MAC.toLowerCase());
		expect(mac).toBe(SERVER_MAC);
		expect(captureHandled).not.toHaveBeenCalled();
	});

	it('does not log when no MAC is claimed', async () => {
		const mac = await resolveMacTrusted(evt, 'u1');
		expect(mac).toBe(SERVER_MAC);
		expect(captureHandled).not.toHaveBeenCalled();
	});
});

/**
 * AC1 — `resolveCheckoutLocation` returns BOTH the legacy networkId reference and the durable
 * circuit-id STRING from the same 5-fallback chain. Tiers 1-2 resolve the circuit-id (from the
 * live network_health row); tiers 3-5 resolve a networkId but return apCircuitId: null (documented
 * known-gap — network_sessions/customer_profile don't cache the circuit-id string today).
 */
describe('resolveCheckoutLocation — durable circuit-id per fallback tier (AC1)', () => {
	const locEvt = { getClientAddress: () => '10.0.0.5' } as never;
	beforeEach(() => {
		vi.clearAllMocks();
		resetDb();
	});

	it('tier 1 (ap-param): resolves networkId AND the AP row circuit-id string', async () => {
		(getPortalContext as ReturnType<typeof vi.fn>).mockReturnValue({ ap: 'iface-1' });
		(resolveNetworkIdByApName as ReturnType<typeof vi.fn>).mockResolvedValue(7);
		// apCircuitIdForNetworkId's single network_health lookup returns the stored circuit-id.
		selectQueue.push([{ apCircuitId: 'OLT-9 xpon 0/1/0/4' }]);
		const loc = await resolveCheckoutLocation(locEvt, 'u1');
		expect(loc).toEqual({ networkId: 7, apCircuitId: 'OLT-9 xpon 0/1/0/4' });
	});

	it('tier 1 with a network_health row carrying no circuit-id → networkId set, apCircuitId null', async () => {
		(getPortalContext as ReturnType<typeof vi.fn>).mockReturnValue({ ap: 'iface-1' });
		(resolveNetworkIdByApName as ReturnType<typeof vi.fn>).mockResolvedValue(7);
		selectQueue.push([{ apCircuitId: null }]);
		const loc = await resolveCheckoutLocation(locEvt, 'u1');
		expect(loc).toEqual({ networkId: 7, apCircuitId: null });
	});

	it('tier 3 (active-session): networkId resolved, apCircuitId null (known-gap fallback)', async () => {
		// No ap param, no MAC (network stub has no resolveMacByIp) → falls to the active-session query.
		(getPortalContext as ReturnType<typeof vi.fn>).mockReturnValue({});
		selectQueue.push([{ networkId: 5 }]); // active network_sessions row
		const loc = await resolveCheckoutLocation(locEvt, 'u1');
		expect(loc).toEqual({ networkId: 5, apCircuitId: null });
	});

	it('fully unresolved (dev=false): both null, attribution-miss captured', async () => {
		(getPortalContext as ReturnType<typeof vi.fn>).mockReturnValue({});
		selectQueue.push([]); // active-session: none
		selectQueue.push([]); // last-known profile: none
		const loc = await resolveCheckoutLocation(locEvt, 'u1');
		expect(loc).toEqual({ networkId: null, apCircuitId: null });
		expect(captureHandled).toHaveBeenCalledTimes(1);
	});
});
