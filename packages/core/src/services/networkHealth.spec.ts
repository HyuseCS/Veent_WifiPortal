import { describe, it, expect } from 'vitest';
import { isNameUniqueViolation, resolveApCircuitLabel, resolveApNameSnapshot } from './networkHealth';
import type { DB } from '@veent/db';

/**
 * Minimal fake DB for the read-only `resolveApCircuitLabel` join. The function issues exactly one
 * `db.select({...}).from(...).where(...).orderBy(...).limit(1)` chain that awaits to a row array;
 * this chainable stub returns whatever rows it was seeded with (`[]` = no matching AP row, i.e. the
 * AP was pruned). No real Postgres needed — matches the fake-object style used across these specs.
 */
function fakeLabelDb(rows: Array<{ name: string; displayName?: string | null }>): DB {
	const chain: Record<string, unknown> = {};
	for (const m of ['select', 'from', 'where', 'orderBy']) chain[m] = () => chain;
	chain.limit = () => Promise.resolve(rows);
	return chain as unknown as DB;
}

/**
 * AC3 discriminator matrix for `isNameUniqueViolation` — no DB, fabricated driver-shaped errors
 * (record-payment.spec.ts style). Covers both constraint field names (postgres.js
 * `constraint_name`, PGlite `constraint`) and the bounded cause-chain depth drizzle-orm introduces.
 */
describe('isNameUniqueViolation (AC3 matrix)', () => {
	it('bare postgres.js-shaped error (constraint_name) → true', () => {
		expect(
			isNameUniqueViolation({ code: '23505', constraint_name: 'network_health_name_key' })
		).toBe(true);
	});

	it('bare PGlite-shaped error (constraint) → true', () => {
		expect(isNameUniqueViolation({ code: '23505', constraint: 'network_health_name_key' })).toBe(
			true
		);
	});

	it('drizzle-wrapped (cause depth 1) → true', () => {
		expect(
			isNameUniqueViolation({
				name: 'DrizzleQueryError',
				cause: { code: '23505', constraint: 'network_health_name_key' }
			})
		).toBe(true);
	});

	it('doubly-wrapped (cause depth 2) → true', () => {
		expect(
			isNameUniqueViolation({
				cause: { cause: { code: '23505', constraint_name: 'network_health_name_key' } }
			})
		).toBe(true);
	});

	it('23505 on the mac key → false (absorbed by the conflict target, must not retry)', () => {
		expect(
			isNameUniqueViolation({ code: '23505', constraint_name: 'network_health_mac_key' })
		).toBe(false);
	});

	it('23505 on the pkey → false (sequence drift, not a name collision)', () => {
		expect(isNameUniqueViolation({ code: '23505', constraint: 'network_health_pkey' })).toBe(false);
	});

	it('code-only 23505 with no constraint field anywhere → true (F2 mac-absorption rule)', () => {
		expect(isNameUniqueViolation({ code: '23505' })).toBe(true);
	});

	it('non-23505 SQLSTATE → false', () => {
		expect(
			isNameUniqueViolation({ code: '23503', constraint: 'network_health_name_key' })
		).toBe(false);
	});

	it('random Error → false', () => {
		expect(isNameUniqueViolation(new Error('network_health_name_key'))).toBe(false);
	});

	it('null / undefined → false', () => {
		expect(isNameUniqueViolation(null)).toBe(false);
		expect(isNameUniqueViolation(undefined)).toBe(false);
	});
});

/**
 * AC4/AC5 — read-time label resolver for durable purchase/grant AP attribution. Proves the label
 * tracks a rename (join key is the immutable circuit-id) and falls back to the raw string on prune,
 * never blank / erroring / numeric.
 */
describe('resolveApCircuitLabel (AC4/AC5)', () => {
	const CID = 'OLT-9 xpon 0/1/0/4';

	it('AC4 — AP still exists → current friendly name (survives rename via stable circuit-id)', async () => {
		// First resolution while the AP is named "AP-Pabayo".
		expect(await resolveApCircuitLabel(fakeLabelDb([{ name: 'AP-Pabayo' }]), CID)).toBe('AP-Pabayo');
		// Same circuit-id after the AP was renamed → new friendly name, no stored value changed.
		expect(await resolveApCircuitLabel(fakeLabelDb([{ name: 'AP-Pabayo-North' }]), CID)).toBe(
			'AP-Pabayo-North'
		);
	});

	it('operator display_name wins over the sweep-managed name (durable rename override)', async () => {
		expect(
			await resolveApCircuitLabel(fakeLabelDb([{ name: 'OAP3000G-1a2b', displayName: 'Front Desk' }]), CID)
		).toBe('Front Desk');
	});

	it('AC5 — AP row pruned/deleted → falls back to the raw circuit-id string, no throw', async () => {
		expect(await resolveApCircuitLabel(fakeLabelDb([]), CID)).toBe(CID);
	});

	it('null circuit-id → "Unattributed" (no DB access)', async () => {
		// Passing a db that would throw if touched proves the null short-circuit runs first.
		const explodingDb = { select() { throw new Error('should not query'); } } as unknown as DB;
		expect(await resolveApCircuitLabel(explodingDb, null)).toBe('Unattributed');
	});
});

/**
 * `resolveApNameSnapshot` — the write-time freeze helper. Same label as resolveApCircuitLabel, but
 * null (not "Unattributed") for a null circuit-id, and failure-safe (throw → null) so freezing the
 * name can never fail a purchase/grant.
 */
describe('resolveApNameSnapshot (write-time freeze)', () => {
	const CID = 'OLT-9 xpon 0/1/0/4';

	it('null circuit-id → null (no DB access, read side falls back to live)', async () => {
		const explodingDb = { select() { throw new Error('should not query'); } } as unknown as DB;
		expect(await resolveApNameSnapshot(explodingDb, null)).toBeNull();
	});

	it('resolves display_name ?? name for the current AP', async () => {
		expect(
			await resolveApNameSnapshot(fakeLabelDb([{ name: 'OAP3000G-1a2b', displayName: 'Front Desk' }]), CID)
		).toBe('Front Desk');
		expect(await resolveApNameSnapshot(fakeLabelDb([{ name: 'AP-Pabayo' }]), CID)).toBe('AP-Pabayo');
	});

	it('lookup throws → null (never blocks the grant)', async () => {
		const explodingDb = {
			select() {
				throw new Error('db down');
			}
		} as unknown as DB;
		expect(await resolveApNameSnapshot(explodingDb, CID)).toBeNull();
	});
});
