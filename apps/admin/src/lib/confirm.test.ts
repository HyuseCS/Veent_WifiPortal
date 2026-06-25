import { describe, it, expect } from 'vitest';
import { namesMatch } from './confirm';

/**
 * The type-to-confirm gate for promoting an admin to owner. Enforced on both client
 * (button enable) and server (?/promote), so the rule must be exact and shared.
 */
describe('namesMatch', () => {
	it('matches case-insensitively and ignores surrounding whitespace', () => {
		expect(namesMatch('Ada Lovelace', 'Ada Lovelace')).toBe(true);
		expect(namesMatch('  ada lovelace  ', 'Ada Lovelace')).toBe(true);
		expect(namesMatch('ADA LOVELACE', 'Ada Lovelace')).toBe(true);
	});

	it('rejects a mismatch', () => {
		expect(namesMatch('Ada', 'Ada Lovelace')).toBe(false);
		expect(namesMatch('Alan Turing', 'Ada Lovelace')).toBe(false);
	});

	it('never matches on empty input (an empty target would otherwise pass)', () => {
		expect(namesMatch('', '')).toBe(false);
		expect(namesMatch('   ', 'Ada')).toBe(false);
		expect(namesMatch('', 'Ada')).toBe(false);
	});
});
