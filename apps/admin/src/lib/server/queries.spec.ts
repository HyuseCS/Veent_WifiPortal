import { describe, it, expect, vi } from 'vitest';

/**
 * AC7 (automated leg) — the admin query layer maps a stored durable AP circuit-id to the correct
 * display label for all three attribution states (current friendly name / raw fallback string /
 * "Unattributed") across all three non-Maya grant types (credit spend, points spend, free-time
 * grant). `resolveApCircuitLabel` (the actual network_health join) is unit-proven separately in
 * packages/core; here it is mocked so the test drives each attribution state deterministically and
 * asserts the query attaches the right label per grant type. No DB — a queued fake db.select chain.
 *
 * The Agent-Probe leg (rendered admin page) + human verification handoff are the Hybrid gate's
 * second half and are NOT covered here by design.
 */
vi.mock('@veent/core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@veent/core')>();
	return {
		...actual,
		// friendly (live AP) → name; pruned AP → raw circuit-id echoed back; matches the real contract.
		resolveApCircuitLabel: vi.fn(async (_db: unknown, cid: string | null) => {
			if (cid == null) return 'Unattributed';
			if (cid === 'live-1') return 'AP-Pabayo';
			return cid; // pruned AP → raw fallback
		})
	};
});

import { listRecentGrantAttribution } from './queries';

// A shared chainable db.select stub whose terminal await shifts one result off `queue`, in call
// order. listRecentGrantAttribution issues its 3 table selects synchronously left-to-right
// (credits, points, free-time) inside Promise.all, so the queue order is deterministic.
function fakeDb(queue: unknown[][]) {
	const chain: Record<string, unknown> = {};
	for (const m of ['select', 'from', 'leftJoin', 'where', 'orderBy']) chain[m] = () => chain;
	chain.limit = () => Promise.resolve(queue.shift() ?? []);
	return { select: () => chain } as never;
}

describe('listRecentGrantAttribution — durable AP label per grant type (AC7)', () => {
	it('maps friendly / raw-fallback / Unattributed across credit, points, and free-time grants', async () => {
		const now = new Date('2026-07-21T10:00:00Z');
		const db = fakeDb([
			// credits (live AP → friendly name)
			[{ amount: -50, apCircuitId: 'live-1', createdAt: now, who: 'Alice' }],
			// points (pruned AP → raw circuit-id fallback)
			[{ amount: -10, apCircuitId: 'pruned-2', createdAt: now, who: 'Bob' }],
			// free-time (no AP resolved → Unattributed)
			[{ apCircuitId: null, createdAt: now, who: 'Carol' }]
		]);

		const rows = await listRecentGrantAttribution(db, { limit: 50 });

		const credit = rows.find((r) => r.kind === 'credit');
		const points = rows.find((r) => r.kind === 'points');
		const free = rows.find((r) => r.kind === 'free-time');

		expect(credit?.apCircuitLabel).toBe('AP-Pabayo'); // friendly (survives rename)
		expect(points?.apCircuitLabel).toBe('pruned-2'); // raw fallback (survives prune)
		expect(free?.apCircuitLabel).toBe('Unattributed'); // unresolvable

		// Grant-type-specific detail + guest name are surfaced.
		expect(credit?.who).toBe('Alice');
		expect(points?.detail).toBe('10 points');
		expect(free?.detail).toBe('Free time');
	});

	it('renders "—" for a grant with no linked guest name', async () => {
		const now = new Date();
		const db = fakeDb([[], [], [{ apCircuitId: null, createdAt: now, who: null }]]);
		const rows = await listRecentGrantAttribution(db, { limit: 10 });
		expect(rows).toHaveLength(1);
		expect(rows[0].who).toBe('—');
		expect(rows[0].apCircuitLabel).toBe('Unattributed');
	});
});
