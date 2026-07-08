import { describe, it, expect } from 'vitest';
import { isNetworkHealthStale, NETWORK_HEALTH_STALE_MS } from '@veent/db';

/**
 * B3.5 — the shared read-side staleness boundary. Both the admin Networks page and the public
 * locator derive "is this AP's data still trustworthy?" from this one function, so the two can't
 * disagree. Pins the boundary and the never-sampled case.
 */
describe('isNetworkHealthStale boundary', () => {
	const now = new Date(1_000_000_000_000);

	it('is fresh at exactly the ceiling and just inside it', () => {
		expect(isNetworkHealthStale(new Date(now.getTime()), now)).toBe(false);
		expect(isNetworkHealthStale(new Date(now.getTime() - (NETWORK_HEALTH_STALE_MS - 1)), now)).toBe(
			false
		);
		// Exactly at the ceiling is NOT stale (strict >).
		expect(isNetworkHealthStale(new Date(now.getTime() - NETWORK_HEALTH_STALE_MS), now)).toBe(false);
	});

	it('is stale one ms past the ceiling', () => {
		expect(isNetworkHealthStale(new Date(now.getTime() - (NETWORK_HEALTH_STALE_MS + 1)), now)).toBe(
			true
		);
	});

	it('treats a never-sampled row (null) as stale', () => {
		expect(isNetworkHealthStale(null, now)).toBe(true);
		expect(isNetworkHealthStale(undefined, now)).toBe(true);
	});
});
