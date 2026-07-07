import { describe, it, expect } from 'vitest';
import { otherAccountAccessUntilForMac } from '@veent/core';

/**
 * The dashboard "this device already has time under another account" warning (shared-device
 * double-buy guard) is driven by otherAccountAccessUntilForMac: it returns the OTHER account's live
 * window end for a MAC, or null when no other account is live on it.
 */

// Minimal chainable Drizzle stand-in: every builder method returns the chain; awaiting the final
// `.limit()` resolves the preset rows. Mirrors the query shape in the helper.
function fakeDb(rows: unknown[]) {
	const chain: Record<string, unknown> = {
		select: () => chain,
		from: () => chain,
		innerJoin: () => chain,
		where: () => chain,
		orderBy: () => chain,
		limit: () => Promise.resolve(rows)
	};
	return chain as never;
}

describe('otherAccountAccessUntilForMac (shared-device buy warning)', () => {
	it("returns the other account's window end when one is live on the MAC", async () => {
		const until = new Date('2026-07-07T15:00:00Z');
		const got = await otherAccountAccessUntilForMac(fakeDb([{ until }]), 'AA:BB:CC:DD:EE:01', 'u1');
		expect(got).toEqual(until);
	});

	it('returns null when no other account is live on the MAC', async () => {
		const got = await otherAccountAccessUntilForMac(fakeDb([]), 'AA:BB:CC:DD:EE:01', 'u1');
		expect(got).toBeNull();
	});
});
