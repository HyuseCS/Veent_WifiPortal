import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * AC3 — `startFreeAccessAndBindDevice` writes the durable AP circuit-id onto the network_sessions
 * row (free time has no ledger row, so this is its ONLY durable AP fact).
 * AC6 — AP-circuit resolution runs BEFORE the transaction and its failure NEVER blocks/rolls back
 * the grant: a forced throw from `resolveCircuitIdForMac` still commits the spend/claim + grant,
 * with attribution recorded null. This is the runtime proof behind the try/catch wrapper in
 * `resolveApCircuitPreTx` (sessions.ts) — negative control: if that wrapper is removed, the forced
 * throw propagates out and these tests go red.
 *
 * `./networkHealth` is module-mocked so the test drives `resolveCircuitIdForMac`'s outcome
 * directly. No DB — a fake tx records the written row and yields one queued result per statement.
 */
vi.mock('./networkHealth', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./networkHealth')>();
	return {
		...actual,
		resolveCircuitIdForMac: vi.fn(),
		// Cid-aware, mirroring the real helper (null cid → null snapshot) so the AC6 rejection cases
		// still see a null name snapshot without a real network_health select.
		resolveApNameSnapshot: vi.fn((_db: unknown, cid: string | null) =>
			Promise.resolve(cid ? 'AP-Pabayo' : null)
		),
		resolveNetworkIdForMac: vi.fn().mockResolvedValue(null) // afterBind → attributeAp no-op
	};
});

import { startPaidAccessAndBindDevice, startFreeAccessAndBindDevice } from './sessions';
import { resolveCircuitIdForMac } from './networkHealth';

const mockResolve = resolveCircuitIdForMac as ReturnType<typeof vi.fn>;

// Chainable Drizzle tx stand-in that records `.values()` and `.set()` payloads and yields one
// queued result per awaited statement, in call order (mirrors grant-atomic.spec.ts + points.spec.ts).
function recordingTx(results: unknown[], writes: { values: unknown[]; sets: unknown[] }) {
	const queue = [...results];
	const proxy: unknown = new Proxy(function () {}, {
		get(_t, prop) {
			if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(queue.shift());
			return (arg: unknown) => {
				if (prop === 'values' && arg !== undefined) writes.values.push(arg);
				if (prop === 'set' && arg !== undefined) writes.sets.push(arg);
				return proxy;
			};
		}
	});
	return proxy;
}

function fakeDb(results: unknown[], writes: { values: unknown[]; sets: unknown[] }) {
	const state = { inTransaction: false };
	const db = {
		transaction: async (fn: (tx: unknown) => unknown) => {
			state.inTransaction = true;
			try {
				return await fn(recordingTx(results, writes));
			} finally {
				state.inTransaction = false;
			}
		}
	} as never;
	return { db, state };
}

// Successful FREE bind of a NEW device (same order as grant-atomic.spec.ts freeBindAwaits):
//   claim UPDATE…returning→[{userId}], profile FOR UPDATE→[{accessExpiresAt}], window update→[],
//   existing-binding select→[], active-rows select→[], insert binding…returning→[{id}], mirror→[]
const freeBindAwaits = (id: number) => [
	[{ userId: 'u1' }],
	[{ accessExpiresAt: null }],
	[],
	[],
	[],
	[{ id }],
	[]
];

// Successful PAID bind of a NEW device:
//   spend update→[{balance}], ledger insert→[], profile FOR UPDATE→[{accessExpiresAt}],
//   window update→[], existing-binding select→[], active-rows select→[], insert→[{id}], mirror→[]
const paidBindAwaits = (balance: number, id: number) => [
	[{ balance }],
	[],
	[{ accessExpiresAt: null }],
	[],
	[],
	[],
	[{ id }],
	[]
];

const freeInput = { userId: 'u1', macAddress: 'AA:BB:CC:DD:EE:FF' };
const paidInput = {
	userId: 'u1',
	macAddress: 'AA:BB:CC:DD:EE:FF',
	packageId: 7,
	amount: 20,
	durationMinutes: 180
};
const okNetwork = () => ({ grant: vi.fn().mockResolvedValue(undefined), revoke: vi.fn() }) as never;

describe('startFreeAccessAndBindDevice — durable AP attribution (AC3)', () => {
	beforeEach(() => vi.clearAllMocks());

	it('writes the resolved circuit-id onto the new network_sessions row', async () => {
		mockResolve.mockResolvedValue('OLT-9 xpon 0/1/0/4');
		const writes = { values: [] as unknown[], sets: [] as unknown[] };
		const { db } = fakeDb(freeBindAwaits(1), writes);
		const res = await startFreeAccessAndBindDevice(db, okNetwork(), freeInput);
		expect(res.ok).toBe(true);
		// The single insert into network_sessions carries the durable circuit-id AND the frozen name.
		expect(
			writes.values.some(
				(v) =>
					(v as { apCircuitId?: string }).apCircuitId === 'OLT-9 xpon 0/1/0/4' &&
					(v as { apNameSnapshot?: string }).apNameSnapshot === 'AP-Pabayo'
			)
		).toBe(true);
	});
});

describe('AP-circuit resolution runs pre-tx and never blocks the grant (AC6)', () => {
	beforeEach(() => vi.clearAllMocks());

	it('FREE: a forced resolveCircuitIdForMac rejection still commits the grant, attribution null', async () => {
		mockResolve.mockRejectedValue(new Error('router circuit lookup exploded'));
		const writes = { values: [] as unknown[], sets: [] as unknown[] };
		const { db, state } = fakeDb(freeBindAwaits(2), writes);
		let grantInTx: boolean | null = null;
		const network = {
			grant: vi.fn().mockImplementation(() => {
				grantInTx = state.inTransaction;
				return Promise.resolve(undefined);
			}),
			revoke: vi.fn()
		} as never;
		const res = await startFreeAccessAndBindDevice(db, network, freeInput);
		expect(res.ok).toBe(true); // grant NOT blocked by the resolution failure
		expect(grantInTx).toBe(true);
		expect((network as { grant: ReturnType<typeof vi.fn> }).grant).toHaveBeenCalledOnce();
		// Resolution failed → attribution recorded null on the inserted row.
		const inserted = writes.values.find((v) => 'apCircuitId' in (v as object)) as {
			apCircuitId: unknown;
		};
		expect(inserted.apCircuitId).toBeNull();
	});

	it('PAID: a forced resolveCircuitIdForMac rejection still commits spend + grant, attribution null', async () => {
		mockResolve.mockRejectedValue(new Error('router circuit lookup exploded'));
		const writes = { values: [] as unknown[], sets: [] as unknown[] };
		const { db, state } = fakeDb(paidBindAwaits(60, 3), writes);
		let grantInTx: boolean | null = null;
		const network = {
			grant: vi.fn().mockImplementation(() => {
				grantInTx = state.inTransaction;
				return Promise.resolve(undefined);
			}),
			revoke: vi.fn()
		} as never;
		const res = await startPaidAccessAndBindDevice(db, network, paidInput);
		expect(res.ok).toBe(true);
		expect(grantInTx).toBe(true);
		// The credit_ledger spend row AND the network_sessions row both carry apCircuitId null.
		expect(writes.values.length).toBeGreaterThan(0);
		for (const v of writes.values) {
			if ('apCircuitId' in (v as object)) {
				expect((v as { apCircuitId: unknown }).apCircuitId).toBeNull();
			}
		}
	});
});
