import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveDeviceMac } from '@veent/core';

/**
 * B3.3 — the IP→MAC error-path fallback must be age-bounded. On a router-API outage
 * `resolveDeviceMac` serves the last-known MAC for the IP (better than a false "can't detect"),
 * but only within MAC_CACHE_STALE_MAX_MS (5 min). Past that a DHCP lease may have moved the IP
 * to a different device, so a stale MAC is worse than null — it would drop the firewall for the
 * wrong device (admin postLogin) or mis-identify the device (customer portal).
 *
 * We drive the clock with a Date.now spy and use a distinct IP per test so the module-level
 * cache doesn't leak between cases. The first (successful) call seeds the cache; a second call
 * after the router starts failing exercises the catch branch.
 */

afterEach(() => vi.restoreAllMocks());

const MIN = 60_000;

function stubNow(startMs: number) {
	const clock = { ms: startMs };
	vi.spyOn(Date, 'now').mockImplementation(() => clock.ms);
	return clock;
}

describe('resolveDeviceMac error-path staleness bound', () => {
	it('serves the last-known MAC on a router outage within the 5-min ceiling', async () => {
		const clock = stubNow(1_000_000);
		const mac = 'AA:BB:CC:DD:EE:01';
		// First call resolves (seeds cache), later calls reject (router unreachable).
		const resolveMacByIp = vi.fn().mockResolvedValueOnce(mac).mockRejectedValue(new Error('down'));
		const network = { resolveMacByIp } as never;

		expect(await resolveDeviceMac(network, '10.0.0.1')).toBe(mac);

		clock.ms += 2 * MIN; // past the 60s TTL (forces a re-query) but within the 5-min ceiling
		expect(await resolveDeviceMac(network, '10.0.0.1')).toBe(mac);
		expect(resolveMacByIp).toHaveBeenCalledTimes(2); // happy-path TTL was bypassed
	});

	it('returns null when the cached MAC is older than the 5-min ceiling', async () => {
		const clock = stubNow(1_000_000);
		const mac = 'AA:BB:CC:DD:EE:02';
		const resolveMacByIp = vi.fn().mockResolvedValueOnce(mac).mockRejectedValue(new Error('down'));
		const network = { resolveMacByIp } as never;

		expect(await resolveDeviceMac(network, '10.0.0.2')).toBe(mac);

		clock.ms += 6 * MIN; // past the 5-min stale ceiling
		expect(await resolveDeviceMac(network, '10.0.0.2')).toBeNull();
	});
});
