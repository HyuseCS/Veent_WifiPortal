import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveDeviceMac } from './adminAccess';

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

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

describe('relay MAC guard', () => {
	const relay = 'F4:B7:8D:A6:80:88';
	const real = '2E:47:8F:2D:35:8F';
	const load = async () => {
		vi.resetModules();
		return import('./adminAccess');
	};
	const relayedLeases = () => [
		{
			mac: real,
			address: '10.210.44.159',
			hostname: null,
			agentCircuitId: 'OLT-9 xpon 0/1/0/4:16.3.70',
			status: 'bound',
			srcMac: relay
		}
	];

	it('dropRelayMac drops a relay MAC in any case, keeps a normal one, nulls empty', async () => {
		const { dropRelayMac } = await load();
		const network = { listDhcpLeases: vi.fn().mockResolvedValue(relayedLeases()) } as never;
		expect(await dropRelayMac(network, relay)).toBeNull();
		expect(await dropRelayMac(network, relay.toLowerCase())).toBeNull();
		expect(await dropRelayMac(network, real)).toBe(real);
		expect(await dropRelayMac(network, '')).toBeNull();
		expect(await dropRelayMac(network, null)).toBeNull();
	});

	it('a lease with srcMac equal to mac, srcMac null, or no circuit-id adds nothing', async () => {
		const { dropRelayMac } = await load();
		const hostNic = '9C:E3:74:DC:4F:4A';
		const network = {
			listDhcpLeases: vi.fn().mockResolvedValue([
				{ ...relayedLeases()[0], srcMac: real },
				{ ...relayedLeases()[0], mac: relay, srcMac: null },
				{ ...relayedLeases()[0], mac: '00:15:5D:DD:79:05', srcMac: hostNic, agentCircuitId: null }
			])
		} as never;
		expect(await dropRelayMac(network, real)).toBe(real);
		expect(await dropRelayMac(network, relay)).toBe(relay);
		expect(await dropRelayMac(network, hostNic)).toBe(hostNic);
	});

	it('reads listDhcpLeases once per 5 min', async () => {
		let now = 9_000_000;
		vi.spyOn(Date, 'now').mockImplementation(() => now);
		const { dropRelayMac } = await load();
		const listDhcpLeases = vi.fn().mockResolvedValue(relayedLeases());
		const network = { listDhcpLeases } as never;
		await dropRelayMac(network, relay);
		now += 4 * 60_000;
		await dropRelayMac(network, relay);
		expect(listDhcpLeases).toHaveBeenCalledTimes(1);
		now += 2 * 60_000;
		await dropRelayMac(network, relay);
		expect(listDhcpLeases).toHaveBeenCalledTimes(2);
	});

	it('shares one read across parallel calls', async () => {
		const { dropRelayMac } = await load();
		const listDhcpLeases = vi.fn().mockResolvedValue(relayedLeases());
		const network = { listDhcpLeases } as never;
		await Promise.all([
			dropRelayMac(network, relay),
			dropRelayMac(network, real),
			dropRelayMac(network, relay)
		]);
		expect(listDhcpLeases).toHaveBeenCalledTimes(1);
	});

	it('a throwing listDhcpLeases passes the MAC and does not throw', async () => {
		const { dropRelayMac } = await load();
		const network = {
			listDhcpLeases: vi.fn().mockRejectedValue(new Error('router down'))
		} as never;
		expect(await dropRelayMac(network, relay)).toBe(relay);
	});

	it('a hanging listDhcpLeases passes the MAC after 2.5 s', async () => {
		vi.useFakeTimers();
		const { dropRelayMac } = await load();
		const network = { listDhcpLeases: vi.fn().mockReturnValue(new Promise(() => {})) } as never;
		const p = dropRelayMac(network, relay);
		await vi.advanceTimersByTimeAsync(2_600);
		expect(await p).toBe(relay);
	});

	it('a missing listDhcpLeases passes the MAC', async () => {
		const { dropRelayMac } = await load();
		expect(await dropRelayMac({} as never, relay)).toBe(relay);
	});

	it('keeps the last set when a later read fails', async () => {
		let now = 12_000_000;
		vi.spyOn(Date, 'now').mockImplementation(() => now);
		const { dropRelayMac } = await load();
		const listDhcpLeases = vi
			.fn()
			.mockResolvedValueOnce(relayedLeases())
			.mockRejectedValue(new Error('router down'));
		const network = { listDhcpLeases } as never;
		expect(await dropRelayMac(network, relay)).toBeNull();
		now += 6 * 60_000;
		expect(await dropRelayMac(network, relay)).toBeNull();
		expect(listDhcpLeases).toHaveBeenCalledTimes(2);
	});

	it('keeps the last set when a later read has no relayed lease', async () => {
		let now = 15_000_000;
		vi.spyOn(Date, 'now').mockImplementation(() => now);
		const { dropRelayMac } = await load();
		const listDhcpLeases = vi.fn().mockResolvedValueOnce(relayedLeases()).mockResolvedValue([]);
		const network = { listDhcpLeases } as never;
		expect(await dropRelayMac(network, relay)).toBeNull();
		now += 6 * 60_000;
		expect(await dropRelayMac(network, relay)).toBeNull();
		expect(listDhcpLeases).toHaveBeenCalledTimes(2);
	});

	it('resolveDeviceMac returns null for a relay router result after 1 attempt and does not cache it', async () => {
		const { resolveDeviceMac } = await load();
		const resolveMacByIp = vi.fn().mockResolvedValue(relay);
		const network = {
			resolveMacByIp,
			listDhcpLeases: vi.fn().mockResolvedValue(relayedLeases())
		} as never;
		const ip = '10.99.8.31';
		expect(await resolveDeviceMac(network, ip)).toBeNull();
		expect(resolveMacByIp).toHaveBeenCalledTimes(1);
		expect(await resolveDeviceMac(network, ip)).toBeNull();
		expect(resolveMacByIp).toHaveBeenCalledTimes(2);
	});

	it('grantAdminAccess skips a relay MAC and grants a real one', async () => {
		const { grantAdminAccess } = await load();
		const grant = vi.fn().mockResolvedValue(undefined);
		const network = { grant, listDhcpLeases: vi.fn().mockResolvedValue(relayedLeases()) } as never;
		await grantAdminAccess(network, relay);
		expect(grant).not.toHaveBeenCalled();
		await grantAdminAccess(network, real);
		expect(grant).toHaveBeenCalledTimes(1);
	});
});
