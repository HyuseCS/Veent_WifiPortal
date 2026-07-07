import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * M-1 / L-1 — the grant endpoint must resolve the device MAC SERVER-SIDE and never trust the
 * `macAddress` in the request body. These lock that regression: whatever a caller posts, the access
 * service is invoked with the server-resolved MAC, and a disagreeing body MAC is logged (tripwire).
 */

vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/network', () => ({ network: {} }));
vi.mock('$lib/server/rateLimit', () => ({ rateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('$lib/server/network-location', () => ({
	// The authoritative identity — the endpoint must use THIS, not the posted MAC.
	resolveMacForUser: vi.fn().mockResolvedValue('AA:BB:CC:DD:EE:01'),
	maskMac: (m: string) => m // identity in tests; masking is covered elsewhere
}));
vi.mock('$lib/server/logger', () => ({
	logger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() })
}));
// Keep isValidMac real; stub the account gate + the access service, and capture the mismatch tripwire.
vi.mock('@veent/core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@veent/core')>();
	return {
		...actual,
		getAccount: vi.fn().mockResolvedValue({ blocked: false }),
		startFreeAccessAndBindDevice: vi.fn().mockResolvedValue({ ok: true, accessExpiresAt: new Date() }),
		captureHandled: vi.fn()
	};
});

import { POST } from './+server';
import { startFreeAccessAndBindDevice, captureHandled } from '@veent/core';

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

	it('binds the SERVER-resolved MAC, not the one posted in the body', async () => {
		// Caller lies about the device — posts a foreign MAC to try to grant it access.
		await POST(fakeEvent({ macAddress: 'BB:BB:BB:BB:BB:BB' }));

		expect(startFreeAccessAndBindDevice).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.objectContaining({ userId: 'u1', macAddress: SERVER_MAC })
		);
		// The disagreement is logged as a tamper/diagnostic signal.
		expect(captureHandled).toHaveBeenCalledTimes(1);
	});

	it('resolves the MAC with no body MAC supplied, and does not log a mismatch', async () => {
		await POST(fakeEvent({}));

		expect(startFreeAccessAndBindDevice).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.objectContaining({ macAddress: SERVER_MAC })
		);
		expect(captureHandled).not.toHaveBeenCalled();
	});
});
