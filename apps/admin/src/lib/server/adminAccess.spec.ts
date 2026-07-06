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
		// 1 (seed) + 3 (the re-query retries all reject before the stale fallback kicks in).
		expect(resolveMacByIp).toHaveBeenCalledTimes(4);
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

/**
 * The admin grant bug: getClientAddress() on a dual-stack listener hands back an IPv4-mapped IPv6
 * address (`::ffff:10.0.0.5`), but RouterOS stores plain IPv4. resolveDeviceMac must strip the
 * prefix before querying, or the router lookup misses → mac null → the `veent-admin` binding is
 * never written (guest path worked because it strips at its own call sites). Without the strip
 * these assertions fail: resolveMacByIp is called with the `::ffff:`-prefixed IP and returns null.
 */
describe('resolveDeviceMac strips the IPv4-mapped IPv6 prefix', () => {
	it('queries the router with plain IPv4 when given ::ffff:', async () => {
		stubNow(1_000_000);
		const mac = 'AA:BB:CC:DD:EE:03';
		const resolveMacByIp = vi.fn().mockResolvedValue(mac);
		const network = { resolveMacByIp } as never;

		expect(await resolveDeviceMac(network, '::ffff:10.0.0.3')).toBe(mac);
		expect(resolveMacByIp).toHaveBeenCalledWith('10.0.0.3'); // prefix stripped, not `::ffff:10.0.0.3`
	});
});

/**
 * Capture consistency: the login-instant lookup is flaky (a fresh per-call TLS timeout, or the
 * hotspot host table momentarily empty mid-reconnect) even though the router is authoritative.
 * resolveDeviceMac retries so one transient miss no longer costs the admin the grant that session.
 */
describe('resolveDeviceMac retries a transient miss', () => {
	it('resolves on a later attempt after an early error', async () => {
		stubNow(1_000_000);
		const mac = 'AA:BB:CC:DD:EE:04';
		const resolveMacByIp = vi.fn().mockRejectedValueOnce(new Error('tls timeout')).mockResolvedValue(mac);
		const network = { resolveMacByIp } as never;

		expect(await resolveDeviceMac(network, '10.0.0.4')).toBe(mac);
		expect(resolveMacByIp).toHaveBeenCalledTimes(2); // attempt 1 threw, attempt 2 hit
	});

	it('resolves on a later attempt after a momentary empty (null) result', async () => {
		stubNow(1_000_000);
		const mac = 'AA:BB:CC:DD:EE:05';
		const resolveMacByIp = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(mac);
		const network = { resolveMacByIp } as never;

		expect(await resolveDeviceMac(network, '10.0.0.5')).toBe(mac);
		expect(resolveMacByIp).toHaveBeenCalledTimes(2); // attempt 1 empty, attempt 2 hit
	});

	it('gives up after all attempts miss (no cache to fall back on)', async () => {
		stubNow(1_000_000);
		const resolveMacByIp = vi.fn().mockResolvedValue(null);
		const network = { resolveMacByIp } as never;

		expect(await resolveDeviceMac(network, '10.0.0.6')).toBeNull();
		expect(resolveMacByIp).toHaveBeenCalledTimes(3); // bounded — doesn't spin forever
	});
});
