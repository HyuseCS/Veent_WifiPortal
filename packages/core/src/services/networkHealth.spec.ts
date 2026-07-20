import { describe, it, expect } from 'vitest';
import { isNameUniqueViolation } from './networkHealth';

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
