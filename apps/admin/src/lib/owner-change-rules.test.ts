import { describe, it, expect } from 'vitest';
import { isUnanimous, requiredApprovers } from './owner-change-rules';

/**
 * The load-bearing rule for demoting/removing an owner: unanimous approval from all
 * OTHER current owners. These pin the security-relevant edges — sole owner, stale
 * votes, newly-added owners — so a refactor can't silently weaken the gate.
 */
describe('requiredApprovers', () => {
	it('is every owner except the target', () => {
		expect(requiredApprovers(['a', 'b', 'c'], 'c').sort()).toEqual(['a', 'b']);
	});
});

describe('isUnanimous', () => {
	it('true only when every other owner has approved', () => {
		expect(isUnanimous(['a', 'b', 'c'], 'c', ['a', 'b'])).toBe(true);
		expect(isUnanimous(['a', 'b', 'c'], 'c', ['a'])).toBe(false);
	});

	it('2-owner peer case: the one other owner is enough', () => {
		expect(isUnanimous(['a', 'b'], 'b', ['a'])).toBe(true);
	});

	it('a sole owner can never reach unanimity (last-owner protection)', () => {
		expect(isUnanimous(['a'], 'a', ['a'])).toBe(false);
		expect(isUnanimous(['a'], 'a', [])).toBe(false);
	});

	it("ignores approvals from non-owners (a departed owner's vote does not count)", () => {
		// 'x' approved but is no longer an owner; 'b' (a current owner) has not approved.
		expect(isUnanimous(['a', 'b'], 'a', ['x'])).toBe(false);
	});

	it('a newly-promoted owner becomes newly required', () => {
		// 'c' was just promoted and hasn't approved yet → not yet unanimous.
		expect(isUnanimous(['a', 'b', 'c'], 'a', ['b'])).toBe(false);
		expect(isUnanimous(['a', 'b', 'c'], 'a', ['b', 'c'])).toBe(true);
	});

	it("the target's own vote is irrelevant", () => {
		expect(isUnanimous(['a', 'b'], 'a', ['a'])).toBe(false); // only the target approved
		expect(isUnanimous(['a', 'b'], 'a', ['b'])).toBe(true); // the other owner approved
	});
});
