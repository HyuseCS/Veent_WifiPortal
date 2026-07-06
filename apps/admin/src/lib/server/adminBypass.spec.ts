import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The bypassed device MAC is persisted server-side keyed by the better-auth session token (replacing
 * the old signed cookie, which didn't survive login→logout). These pin the contract: a login stores
 * the device, the layout slide re-grants from the stored MAC (throttled), logout revokes then clears
 * the row, two sessions are independent, and every path no-ops safely when there's no session/row.
 *
 * `eq(col, val)` is stubbed to return `val`, so the fake db's `.where(token)` receives the session
 * token directly — a faithful-enough stand-in for drizzle without a real database.
 */

const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock('drizzle-orm', () => ({ eq: (_col: unknown, val: string) => val }));
vi.mock('@veent/db', () => ({ adminBypassDevice: { sessionToken: {}, mac: {} } }));
vi.mock('$lib/server/db', () => ({
	db: {
		insert: () => ({
			values: (v: { sessionToken: string; mac: string }) => ({
				onConflictDoUpdate: () => {
					store.set(v.sessionToken, v.mac);
					return Promise.resolve();
				}
			})
		}),
		select: () => ({
			from: () => ({
				where: (token: string) => ({
					limit: () => Promise.resolve(store.has(token) ? [{ mac: store.get(token) }] : [])
				})
			})
		}),
		delete: () => ({
			where: (token: string) => {
				store.delete(token);
				return Promise.resolve();
			}
		})
	}
}));
vi.mock('$lib/server/network', () => ({ network: {} }));
vi.mock('$lib/server/logger', () => ({
	logger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() })
}));
vi.mock('@veent/core', () => ({
	grantAdminAccess: vi.fn().mockResolvedValue(undefined),
	revokeAdminAccess: vi.fn().mockResolvedValue(undefined),
	ADMIN_BYPASS_TTL_MINUTES: 240
}));

import { rememberAdminDevice, refreshAdminBypass, revokeAdminBypass } from './adminBypass';
import { grantAdminAccess, revokeAdminAccess } from '@veent/core';

/** Event carrying (or lacking) a signed-in session token, as hooks would populate locals. */
function fakeEvent(token: string | undefined) {
	return { locals: { session: token ? { token } : undefined } } as never;
}

beforeEach(() => {
	store.clear();
	vi.clearAllMocks();
});

describe('rememberAdminDevice', () => {
	it('persists the MAC keyed by session token', async () => {
		await rememberAdminDevice('sess-1', 'AA:BB:CC:DD:EE:01');
		expect(store.get('sess-1')).toBe('AA:BB:CC:DD:EE:01');
	});
});

describe('refreshAdminBypass', () => {
	it('slides the bypass from the stored MAC', async () => {
		await rememberAdminDevice('sess-slide', 'AA:BB:CC:DD:EE:02');
		await refreshAdminBypass(fakeEvent('sess-slide'));
		expect(grantAdminAccess).toHaveBeenCalledWith({}, 'AA:BB:CC:DD:EE:02');
	});

	it('is throttled — a second immediate load does no router work', async () => {
		await rememberAdminDevice('sess-throttle', 'AA:BB:CC:DD:EE:03');
		await refreshAdminBypass(fakeEvent('sess-throttle'));
		await refreshAdminBypass(fakeEvent('sess-throttle'));
		expect(grantAdminAccess).toHaveBeenCalledTimes(1); // within the 2h interval → no re-grant
	});

	it('no-ops when the session has no stored device', async () => {
		await refreshAdminBypass(fakeEvent('sess-empty'));
		expect(grantAdminAccess).not.toHaveBeenCalled();
	});

	it('no-ops when there is no session at all', async () => {
		await refreshAdminBypass(fakeEvent(undefined));
		expect(grantAdminAccess).not.toHaveBeenCalled();
	});
});

describe('revokeAdminBypass', () => {
	it('revokes the stored MAC and clears the row', async () => {
		await rememberAdminDevice('sess-out', 'AA:BB:CC:DD:EE:04');
		await revokeAdminBypass(fakeEvent('sess-out'));
		expect(revokeAdminAccess).toHaveBeenCalledWith({}, 'AA:BB:CC:DD:EE:04');
		expect(store.has('sess-out')).toBe(false);
	});

	it('two sessions revoke independently', async () => {
		await rememberAdminDevice('sess-a', 'AA:BB:CC:DD:EE:0A');
		await rememberAdminDevice('sess-b', 'AA:BB:CC:DD:EE:0B');
		await revokeAdminBypass(fakeEvent('sess-a'));
		expect(revokeAdminAccess).toHaveBeenCalledWith({}, 'AA:BB:CC:DD:EE:0A');
		expect(revokeAdminAccess).not.toHaveBeenCalledWith({}, 'AA:BB:CC:DD:EE:0B');
		expect(store.get('sess-b')).toBe('AA:BB:CC:DD:EE:0B'); // sess-b's binding untouched
	});

	it('no-ops the router when the session has no stored device', async () => {
		await revokeAdminBypass(fakeEvent('sess-none'));
		expect(revokeAdminAccess).not.toHaveBeenCalled();
	});
});
