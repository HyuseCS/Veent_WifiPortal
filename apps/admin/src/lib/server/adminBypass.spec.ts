import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

/**
 * The admin_dev_mac cookie is client-editable (httpOnly stops scripts, not the user), so it is
 * HMAC-signed with BETTER_AUTH_SECRET: only a login-resolved, server-stamped MAC may slide or
 * revoke a bypass. These pin the security contract: a tampered or legacy-unsigned cookie must
 * read as absent (no grant), and a server-set cookie must round-trip.
 */

vi.mock('$env/dynamic/private', () => ({ env: { BETTER_AUTH_SECRET: 'test-secret' } }));
vi.mock('$lib/server/network', () => ({ network: {} }));
vi.mock('$lib/server/logger', () => ({
	logger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() })
}));
vi.mock('@veent/core', () => ({
	grantAdminAccess: vi.fn().mockResolvedValue(undefined),
	revokeAdminAccess: vi.fn().mockResolvedValue(undefined),
	ADMIN_BYPASS_TTL_MINUTES: 240
}));

import { setAdminDevMacCookie, refreshAdminBypass } from './adminBypass';
import { grantAdminAccess } from '@veent/core';

function sig(mac: string): string {
	return createHmac('sha256', 'test-secret').update(mac).digest('base64url');
}

function fakeEvent(cookieValue: string | undefined) {
	return {
		cookies: {
			get: () => cookieValue,
			set: vi.fn(),
			delete: vi.fn()
		}
	} as never;
}

beforeEach(() => vi.clearAllMocks());

describe('admin_dev_mac cookie signing', () => {
	it('sets the cookie as <mac>.<hmac> so only server-stamped values verify', () => {
		const event = fakeEvent(undefined);
		setAdminDevMacCookie(event, 'AA:BB:CC:DD:EE:01');
		const [, value] = (event as { cookies: { set: ReturnType<typeof vi.fn> } }).cookies.set.mock
			.calls[0] as [string, string];
		expect(value).toBe(`AA:BB:CC:DD:EE:01.${sig('AA:BB:CC:DD:EE:01')}`);
	});

	it('slides the bypass for a validly signed cookie', async () => {
		const mac = 'AA:BB:CC:DD:EE:02';
		await refreshAdminBypass(fakeEvent(`${mac}.${sig(mac)}`));
		expect(grantAdminAccess).toHaveBeenCalledWith({}, mac);
	});

	it('ignores a tampered cookie (forged MAC, wrong signature)', async () => {
		// Attacker replaces the MAC but cannot re-sign without the server secret.
		await refreshAdminBypass(fakeEvent(`FF:FF:FF:FF:FF:99.${sig('AA:BB:CC:DD:EE:03')}`));
		expect(grantAdminAccess).not.toHaveBeenCalled();
	});

	it('ignores a legacy unsigned cookie (pre-signing format reads as absent)', async () => {
		await refreshAdminBypass(fakeEvent('AA:BB:CC:DD:EE:04'));
		expect(grantAdminAccess).not.toHaveBeenCalled();
	});
});
