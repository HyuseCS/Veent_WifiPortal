import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * M-1 / L-1 — the grant endpoint must resolve the device MAC SERVER-SIDE and never trust the
 * `macAddress` in the request body. These lock that regression: whatever a caller posts, the trust
 * decision is delegated to `resolveMacTrusted` (posted MAC passed as the advisory arg) and the access
 * service is invoked with the server-resolved MAC. The tamper tripwire itself is covered in
 * `$lib/server/network-location`'s spec.
 */

vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/network', () => ({ network: {} }));
vi.mock('$lib/server/rateLimit', () => ({ rateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('$lib/server/network-location', () => ({
	// The authoritative identity — the endpoint must bind THIS, and hand it the posted MAC to vet.
	resolveMacTrusted: vi.fn().mockResolvedValue('AA:BB:CC:DD:EE:01')
}));
vi.mock('$lib/server/logger', () => ({
	logger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() })
}));
// Keep isValidMac real; stub the account gate + the access service.
vi.mock('@veent/core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@veent/core')>();
	return {
		...actual,
		getAccount: vi.fn().mockResolvedValue({ blocked: false }),
		startFreeAccessAndBindDevice: vi.fn().mockResolvedValue({ ok: true, accessExpiresAt: new Date() })
	};
});

import { POST } from './+server';
import { startFreeAccessAndBindDevice } from '@veent/core';
import { resolveMacTrusted } from '$lib/server/network-location';

const SERVER_MAC = 'AA:BB:CC:DD:EE:01';

function fakeEvent(body: unknown) {
	return {
		locals: { user: { id: 'u1' } },
		request: { json: async () => body },
		getClientAddress: () => '10.0.0.5'
	} as never;
}

describe('grant endpoint — server-authoritative MAC (M-1/L-1)', () => {
	beforeEach(() => vi.clearAllMocks());

	it('binds the SERVER-resolved MAC, handing the posted body MAC to the trust helper', async () => {
		// Caller lies about the device — posts a foreign MAC to try to grant it access.
		await POST(fakeEvent({ macAddress: 'BB:BB:BB:BB:BB:BB' }));

		// The posted MAC is passed through as the advisory arg — the helper owns the trust/log decision.
		expect(resolveMacTrusted).toHaveBeenCalledWith(expect.anything(), 'u1', 'BB:BB:BB:BB:BB:BB');
		// ...and the SERVER-resolved MAC is what actually gets bound.
		expect(startFreeAccessAndBindDevice).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.objectContaining({ userId: 'u1', macAddress: SERVER_MAC })
		);
	});

	it('binds the server MAC when no body MAC is supplied', async () => {
		await POST(fakeEvent({}));

		expect(resolveMacTrusted).toHaveBeenCalledWith(expect.anything(), 'u1', undefined);
		expect(startFreeAccessAndBindDevice).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.objectContaining({ macAddress: SERVER_MAC })
		);
	});
});
