import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logInfo, logWarn, resolveDeviceMac } = vi.hoisted(() => ({
	logInfo: vi.fn(),
	logWarn: vi.fn(),
	resolveDeviceMac: vi.fn()
}));

vi.mock('@sveltejs/kit', () => ({ fail: vi.fn() }));
vi.mock('@veent/core', async () => {
	const { maskIp, maskMac } = await vi.importActual<typeof import('@veent/core')>('@veent/core');
	return {
		getStaffStatus: vi.fn().mockResolvedValue('active'),
		STAFF_STATUS: { active: 'active', pending: 'pending' },
		grantAdminAccess: vi.fn().mockResolvedValue(undefined),
		resolveDeviceMac,
		maskMac,
		maskIp
	};
});
vi.mock('$lib/server/auth', () => ({ auth: { api: { signOut: vi.fn() } } }));
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/network', () => ({ network: {} }));
vi.mock('$lib/server/adminBypass', () => ({ rememberAdminDevice: vi.fn() }));
vi.mock('$lib/server/logger', () => ({
	logger: () => ({ error: vi.fn(), info: logInfo, warn: logWarn })
}));

import { finishStaffSignIn } from './postLogin';

const event = {
	request: { headers: new Headers() },
	getClientAddress: () => '::ffff:10.210.4.7'
} as never;

beforeEach(() => vi.clearAllMocks());

describe('finishStaffSignIn grant logging', () => {
	it('masks ip and mac when the bypass is granted', async () => {
		resolveDeviceMac.mockResolvedValue('AA:BB:CC:DD:35:8F');
		await finishStaffSignIn(event, 'u1', 'tok', { grantDevice: true });
		const msg = logInfo.mock.calls.map((c) => String(c[0])).join('\n');
		expect(msg).toContain('10.210.*.*');
		expect(msg).toContain('**:**:**:**:35:8F');
		expect(msg).not.toContain('10.210.4.7');
		expect(msg).not.toContain('AA:BB:CC:DD');
	});

	it('masks ip when no MAC is found', async () => {
		resolveDeviceMac.mockResolvedValue(null);
		await finishStaffSignIn(event, 'u1', 'tok', { grantDevice: true });
		const msg = logWarn.mock.calls.map((c) => String(c[0])).join('\n');
		expect(msg).toContain('10.210.*.*');
		expect(msg).not.toContain('10.210.4.7');
	});
});
