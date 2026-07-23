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
// Records every db.update().set(...) call so provenance/no-entrench tests can assert whether a MAC
// was persisted (live path / empty-seed) or NOT (fallback over a populated last_known_mac — AC5).
const updateCalls: Array<{ set: unknown }> = [];
function resetDb() {
	selectQueue.length = 0;
	updateCalls.length = 0;
}
vi.mock('$lib/server/db', () => {
	const chain: Record<string, unknown> = {};
	for (const m of ['select', 'from', 'where', 'orderBy']) chain[m] = () => chain;
	chain.limit = () => Promise.resolve(selectQueue.shift() ?? []);
	return {
		db: {
			update: () => ({
				set: (v: unknown) => {
					updateCalls.push({ set: v });
					return { where: async () => {} };
				}
			}),
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

import { resolveMacTrusted, resolveMacForUser, resolveCheckoutLocation } from './network-location';
import { getPortalContext, getDeviceMac } from '$lib/server/portal';
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

	it('tier 1 (ap-param): resolves networkId, circuit-id, AND the frozen name snapshot (display_name wins)', async () => {
		(getPortalContext as ReturnType<typeof vi.fn>).mockReturnValue({ ap: 'iface-1' });
		(resolveNetworkIdByApName as ReturnType<typeof vi.fn>).mockResolvedValue(7);
		// apAttributionForNetworkId's single network_health lookup returns circuit-id + name + displayName.
		selectQueue.push([
			{ apCircuitId: 'OLT-9 xpon 0/1/0/4', name: 'AP-Pabayo', displayName: 'Front Desk' }
		]);
		const loc = await resolveCheckoutLocation(locEvt, 'u1');
		expect(loc).toEqual({
			networkId: 7,
			apCircuitId: 'OLT-9 xpon 0/1/0/4',
			apNameSnapshot: 'Front Desk'
		});
	});

	it('tier 1 falls back to name when no display_name override is set', async () => {
		(getPortalContext as ReturnType<typeof vi.fn>).mockReturnValue({ ap: 'iface-1' });
		(resolveNetworkIdByApName as ReturnType<typeof vi.fn>).mockResolvedValue(7);
		selectQueue.push([{ apCircuitId: 'CID', name: 'AP-Pabayo', displayName: null }]);
		const loc = await resolveCheckoutLocation(locEvt, 'u1');
		expect(loc).toEqual({ networkId: 7, apCircuitId: 'CID', apNameSnapshot: 'AP-Pabayo' });
	});

	it('tier 1 with a network_health row carrying no circuit-id/name → networkId set, others null', async () => {
		(getPortalContext as ReturnType<typeof vi.fn>).mockReturnValue({ ap: 'iface-1' });
		(resolveNetworkIdByApName as ReturnType<typeof vi.fn>).mockResolvedValue(7);
		selectQueue.push([{ apCircuitId: null, name: null, displayName: null }]);
		const loc = await resolveCheckoutLocation(locEvt, 'u1');
		expect(loc).toEqual({ networkId: 7, apCircuitId: null, apNameSnapshot: null });
	});

	it('tier 3 (active-session): networkId resolved, circuit-id + snapshot null (known-gap fallback)', async () => {
		// No ap param, no MAC (network stub has no resolveMacByIp) → falls to the active-session query.
		(getPortalContext as ReturnType<typeof vi.fn>).mockReturnValue({});
		selectQueue.push([{ networkId: 5 }]); // active network_sessions row
		const loc = await resolveCheckoutLocation(locEvt, 'u1');
		expect(loc).toEqual({ networkId: 5, apCircuitId: null, apNameSnapshot: null });
	});

	it('fully unresolved (dev=false): all null, attribution-miss captured', async () => {
		(getPortalContext as ReturnType<typeof vi.fn>).mockReturnValue({});
		selectQueue.push([]); // active-session: none
		selectQueue.push([]); // last-known profile: none
		const loc = await resolveCheckoutLocation(locEvt, 'u1');
		expect(loc).toEqual({ networkId: null, apCircuitId: null, apNameSnapshot: null });
		expect(captureHandled).toHaveBeenCalledTimes(1);
	});
});

/**
 * Circuit-id-first resolution: the device's own Option 82 circuit-id (the grant path's signal)
 * takes precedence over the interface-name `?ap=` tier, so a Maya checkout on a shared hotspot
 * bridge attributes to the real PHYSICAL AP — not the shared bridge interface. Regression fix for
 * `maya-checkout-ap-attribution-interface-not-physical`.
 */
describe('resolveCheckoutLocation — circuit-id beats interface-name (physical AP)', () => {
	const locEvt = { getClientAddress: () => '10.0.0.5' } as never;
	const CID = 'OLT-9 xpon 0/1/0/4:16.3.70';
	beforeEach(() => {
		vi.clearAllMocks();
		resetDb();
	});

	it('resolves the device circuit-id → physical AP and does NOT consult the ?ap= interface', async () => {
		// Portal carries BOTH the guest MAC and the shared-bridge ap-param. The circuit-id tier must win.
		(getPortalContext as ReturnType<typeof vi.fn>).mockReturnValue({
			mac: 'AA:BB:CC:DD:EE:01',
			ap: 'bridge1_WiFi_Project'
		});
		selectQueue.push([{ circuitId: CID }]); // resolveCircuitIdForMac cache hit
		selectQueue.push([{ id: 14, name: 'OAP3000G-FC6G', displayName: 'AP-PABAYO' }]); // apRowForCircuitId
		const loc = await resolveCheckoutLocation(locEvt, 'u1');
		expect(loc).toEqual({ networkId: 14, apCircuitId: CID, apNameSnapshot: 'AP-PABAYO' });
		// ap-param path never reached — the shared bridge must NOT win over the device's circuit-id.
		expect(resolveNetworkIdByApName).not.toHaveBeenCalled();
	});

	it('falls back to the ?ap= tier when the device has no resolvable circuit-id', async () => {
		(getPortalContext as ReturnType<typeof vi.fn>).mockReturnValue({
			mac: 'AA:BB:CC:DD:EE:01',
			ap: 'iface-1'
		});
		(resolveNetworkIdByApName as ReturnType<typeof vi.fn>).mockResolvedValue(7);
		selectQueue.push([]); // resolveCircuitIdForMac cache miss → null (stub has no resolveApForMac)
		selectQueue.push([{ apCircuitId: 'CID-x', name: 'AP-x', displayName: null }]); // apAttributionForNetworkId(7)
		const loc = await resolveCheckoutLocation(locEvt, 'u1');
		expect(loc).toEqual({ networkId: 7, apCircuitId: 'CID-x', apNameSnapshot: 'AP-x' });
		expect(resolveNetworkIdByApName).toHaveBeenCalledOnce();
	});
});

/**
 * MAC-trust grant fix — `resolveMacForUser` now returns LIVE-vs-FALLBACK provenance and a fallback
 * (device-cookie) MAC must never overwrite a populated durable `last_known_mac` (AC1, AC2, AC5).
 */
describe('resolveMacForUser — live/fallback provenance + no-entrench (AC1/AC2/AC5)', () => {
	const provEvt = { getClientAddress: () => '10.0.0.5' } as never;
	beforeEach(() => {
		vi.clearAllMocks();
		resetDb();
	});

	it('13a: live hit (portal cookie) ⇒ { live: true } and persists the MAC', async () => {
		(getPortalContext as ReturnType<typeof vi.fn>).mockReturnValue({ mac: SERVER_MAC });
		const r = await resolveMacForUser(provEvt, 'u1');
		expect(r).toEqual({ mac: SERVER_MAC, live: true });
		// live branch always persists (rememberAccountMac) — the durable fallback is refreshed.
		expect(updateCalls.length).toBe(1);
	});

	it('13b: all live miss + device cookie ⇒ { mac: <device>, live: false }', async () => {
		(getPortalContext as ReturnType<typeof vi.fn>).mockReturnValue({}); // no portal mac
		(getDeviceMac as ReturnType<typeof vi.fn>).mockReturnValue('CC:CC:CC:CC:CC:CC');
		// seedAccountMac reads accountMac first; empty queue ⇒ null ⇒ seed proceeds.
		const r = await resolveMacForUser(provEvt, 'u1');
		expect(r).toEqual({ mac: 'CC:CC:CC:CC:CC:CC', live: false });
	});

	it('13c: fallback (device cookie) does NOT overwrite a populated last_known_mac (AC5 no-entrench)', async () => {
		(getPortalContext as ReturnType<typeof vi.fn>).mockReturnValue({}); // no portal mac
		(getDeviceMac as ReturnType<typeof vi.fn>).mockReturnValue('CC:CC:CC:CC:CC:CC');
		selectQueue.push([{ mac: 'EE:EE:EE:EE:EE:EE' }]); // accountMac read → already populated
		const r = await resolveMacForUser(provEvt, 'u1');
		expect(r).toEqual({ mac: 'CC:CC:CC:CC:CC:CC', live: false });
		// Negative control: the durable value existed, so NO update must run — a fallback never entrenches.
		expect(updateCalls.length).toBe(0);
	});

	it('13c-seed: fallback seeds ONLY when last_known_mac is empty', async () => {
		(getPortalContext as ReturnType<typeof vi.fn>).mockReturnValue({}); // no portal mac
		(getDeviceMac as ReturnType<typeof vi.fn>).mockReturnValue('CC:CC:CC:CC:CC:CC');
		selectQueue.push([]); // accountMac read → null (no durable value yet)
		await resolveMacForUser(provEvt, 'u1');
		// Empty durable value → seed proceeds (exactly one persist of the device MAC).
		expect(updateCalls.length).toBe(1);
		expect(updateCalls[0].set).toEqual({ lastKnownMac: 'CC:CC:CC:CC:CC:CC' });
	});

	it('13d: live hit still persists (rememberAccountMac unchanged on the live branch)', async () => {
		(getPortalContext as ReturnType<typeof vi.fn>).mockReturnValue({ mac: SERVER_MAC });
		await resolveMacForUser(provEvt, 'u1');
		expect(updateCalls.length).toBe(1);
		expect(updateCalls[0].set).toEqual({ lastKnownMac: SERVER_MAC });
	});
});
