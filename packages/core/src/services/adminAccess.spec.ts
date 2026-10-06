import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveDeviceMac } from './adminAccess';

afterEach(() => vi.restoreAllMocks());

describe('resolveDeviceMac [mac-diag] source log', () => {
	it('logs router-cache on a fresh cache hit', async () => {
		let now = 5_000_000;
		vi.spyOn(Date, 'now').mockImplementation(() => now);
		const info = vi.spyOn(console, 'info').mockImplementation(() => {});
		const resolveMacByIp = vi.fn().mockResolvedValue('F4:B7:8D:A6:80:88');
		const network = { resolveMacByIp } as never;
		const ip = '10.99.7.21';

		expect(await resolveDeviceMac(network, ip)).toBe('F4:B7:8D:A6:80:88');
		now += 10_000;
		info.mockClear();
		expect(await resolveDeviceMac(network, ip)).toBe('F4:B7:8D:A6:80:88');

		expect(resolveMacByIp).toHaveBeenCalledTimes(1);
		const diag = info.mock.calls.filter((c) => c[0] === '[mac-diag]');
		expect(diag).toEqual([
			['[mac-diag]', { source: 'router-cache', mac: '**:**:**:**:80:88', ip: '10.99.*.*' }]
		]);
	});
});
