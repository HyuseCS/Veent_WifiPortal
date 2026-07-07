import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * M-1 / L-1 — `resolveMacTrusted` returns ONLY the server-resolved MAC and fires a tamper tripwire
 * (masked, userId-only) when a caller's advisory `claimedMac` disagrees. This is the shared seam behind
 * the grant endpoint and the dashboard grant actions, so the tripwire behaviour is asserted once here.
 */

vi.mock('$app/environment', () => ({ dev: false }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));
// rememberAccountMac does db.update().set().where(); give it a resolving chain.
vi.mock('$lib/server/db', () => ({
	db: { update: () => ({ set: () => ({ where: async () => {} }) }) }
}));
vi.mock('$lib/server/network', () => ({ network: {} }));
vi.mock('$lib/server/portal', () => ({
	getPortalContext: vi.fn(),
	getDeviceMac: vi.fn(),
	persistResolvedMac: vi.fn()
}));
vi.mock('@veent/core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@veent/core')>();
	return { ...actual, captureHandled: vi.fn() };
});

import { resolveMacTrusted } from './network-location';
import { getPortalContext } from '$lib/server/portal';
import { captureHandled } from '@veent/core';

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
