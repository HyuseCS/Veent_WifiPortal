import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/network', () => ({
	network: {
		listDhcpLeases: vi.fn(async () => [
			{
				mac: '2E:47:8F:2D:35:8F',
				address: '10.210.44.159',
				hostname: null,
				agentCircuitId: 'OLT-9 xpon 0/1/0/4:16.3.70',
				status: 'bound',
				srcMac: 'F4:B7:8D:A6:80:88'
			}
		])
	}
}));

import { capturePortalContext, PORTAL_COOKIE, DEVICE_COOKIE } from './portal';

const eventFor = (qs: string) => {
	const set = vi.fn();
	return {
		event: { url: new URL(`http://portal/${qs}`), cookies: { get: vi.fn(), set } } as never,
		set
	};
};

describe('capturePortalContext relay MAC guard (FR-011)', () => {
	beforeEach(() => vi.clearAllMocks());

	it('sets no cookie for a relay MAC in ?mac=', async () => {
		const { event, set } = eventFor('?mac=F4-B7-8D-A6-80-88');
		await capturePortalContext(event);
		expect(set).not.toHaveBeenCalled();
	});

	it('sets veent_portal and veent_device for a normal MAC', async () => {
		const { event, set } = eventFor('?mac=AA-BB-CC-DD-EE-07');
		await capturePortalContext(event);
		const names = set.mock.calls.map((c) => c[0]);
		expect(names).toEqual([PORTAL_COOKIE, DEVICE_COOKIE]);
	});
});
