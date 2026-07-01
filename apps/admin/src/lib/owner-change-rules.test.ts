import { describe, it, expect } from 'vitest';
import {
	assembleOpenRequests,
	isUnanimous,
	requiredApprovers,
	type OpenRequestRow
} from './owner-change-rules';

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

describe('assembleOpenRequests', () => {
	const row = (over: Partial<OpenRequestRow> = {}): OpenRequestRow => ({
		id: 'r1',
		targetId: 'c',
		targetName: 'Cleo',
		action: 'demote',
		initiatedById: 'a',
		expiresAt: 10_000,
		...over
	});
	const nameById = new Map([
		['a', 'Olivia'],
		['b', 'Bea'],
		['c', 'Cleo']
	]);

	it('groups the single batched approvals query back per request', () => {
		// One flat approvals list for two requests → each row gets only its own approvals.
		const rows = [row({ id: 'r1', targetId: 'c' }), row({ id: 'r2', targetId: 'b' })];
		const approvals = new Map([
			['r1', ['a']],
			['r2', ['a', 'c']]
		]);
		const out = assembleOpenRequests(rows, ['a', 'b', 'c'], nameById, approvals, 0);
		expect(out.find((r) => r.id === 'r1')?.approvedOwnerIds).toEqual(['a']);
		expect(out.find((r) => r.id === 'r2')?.approvedOwnerIds.sort()).toEqual(['a', 'c']);
	});

	it('computes required owners (all except target) and the initiator name', () => {
		const out = assembleOpenRequests([row()], ['a', 'b', 'c'], nameById, new Map(), 0);
		expect(out[0].requiredOwnerIds.sort()).toEqual(['a', 'b']);
		expect(out[0].initiatedByName).toBe('Olivia');
	});

	it('counts only CURRENT owners as approved (a departed owner drops out)', () => {
		const approvals = new Map([['r1', ['a', 'x']]]); // 'x' no longer an owner
		const out = assembleOpenRequests([row()], ['a', 'b', 'c'], nameById, approvals, 0);
		expect(out[0].approvedOwnerIds).toEqual(['a']);
	});

	it('flags expiry against now, with no approvals as an empty list', () => {
		const out = assembleOpenRequests([row({ expiresAt: 500 })], ['a', 'b'], nameById, new Map(), 1_000);
		expect(out[0].expired).toBe(true);
		expect(out[0].approvedOwnerIds).toEqual([]);
		expect(out[0].initiatedByName).toBe('Olivia');
	});
});
