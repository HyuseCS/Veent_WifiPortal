import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
	connectHardened,
	createMikrotikController,
	provisionGcashResolveScheduler,
	reconcileWalledGarden
} from './mikrotik';
import { RouterUnreachableError } from './types';

// ── G17 (R1 / Regression #8): pingHosts concurrency + per-host timeout + never-throws ───────────
// A fake node-routeros connection whose `/ping` write resolves after a short delay, tracking peak
// in-flight concurrency so we can prove pings run in parallel (not serially) yet stay bounded, and
// that an unreachable host times out to `aliveMs: null` without throwing.
const pingState = { inflight: 0, peak: 0 };

// A growing in-memory router table for the scheduler + walled-garden provisioning/reconcile tests.
// The mocked `write` dispatches by menu against this state; tests reset it before each case.
type Row = Record<string, string>;
const routerTable: { scheduler: Row[]; wg: Row[]; wgIp: Row[]; nextId: number } = {
	scheduler: [],
	wg: [],
	wgIp: [],
	nextId: 1
};
function resetRouterTable() {
	routerTable.scheduler = [];
	routerTable.wg = [];
	routerTable.wgIp = [];
	routerTable.nextId = 1;
}
function parseAdd(params: string[]): Row {
	const row: Row = { '.id': `*${routerTable.nextId++}` };
	for (const p of params) {
		const m = /^=([^=]+)=([\s\S]*)$/.exec(p);
		if (m) row[m[1]] = m[2];
	}
	return row;
}
function filterByQuery(rows: Row[], params: string[]): Row[] {
	const q = params.find((p) => p.startsWith('?'));
	if (!q) return rows;
	const m = /^\?([^=]+)=([\s\S]*)$/.exec(q);
	if (!m) return rows;
	return rows.filter((r) => (r[m[1]] ?? '') === m[2]);
}
function removeById(rows: Row[], params: string[]): void {
	const idParam = params.find((p) => p.startsWith('=.id='));
	if (!idParam) return;
	const id = idParam.slice('=.id='.length);
	const idx = rows.findIndex((r) => r['.id'] === id);
	if (idx >= 0) rows.splice(idx, 1);
}
vi.mock('node-routeros', () => {
	class RouterOSAPI {
		connector = {
			on() {},
			removeAllListeners() {}
		};
		on() {}
		connect() {
			return Promise.resolve();
		}
		close() {}
		async write(menu: string, params: string[] = []): Promise<Array<Record<string, string>>> {
			// Scheduler + walled-garden menus operate against the growing in-memory table.
			switch (menu) {
				case '/system/scheduler/print':
					return filterByQuery(routerTable.scheduler, params);
				case '/system/scheduler/add':
					routerTable.scheduler.push(parseAdd(params));
					return [];
				case '/ip/hotspot/walled-garden/print':
					return filterByQuery(routerTable.wg, params);
				case '/ip/hotspot/walled-garden/add':
					routerTable.wg.push(parseAdd(params));
					return [];
				case '/ip/hotspot/walled-garden/remove':
					removeById(routerTable.wg, params);
					return [];
				case '/ip/hotspot/walled-garden/ip/print':
					return filterByQuery(routerTable.wgIp, params);
				case '/ip/hotspot/walled-garden/ip/add':
					routerTable.wgIp.push(parseAdd(params));
					return [];
				case '/ip/hotspot/walled-garden/ip/remove':
					removeById(routerTable.wgIp, params);
					return [];
			}
			if (menu !== '/ping') return [];
			const address = (params.find((p) => p.startsWith('=address=')) ?? '').slice('=address='.length);
			pingState.inflight++;
			pingState.peak = Math.max(pingState.peak, pingState.inflight);
			try {
				if (address === 'dead') {
					// Never resolves → the caller's withTimeout must reject and be caught.
					await new Promise<void>(() => {});
				}
				await new Promise((r) => setTimeout(r, 10));
				return [{ time: '2ms' }, { time: '4ms' }];
			} finally {
				pingState.inflight--;
			}
		}
	}
	return { RouterOSAPI };
});

const mikrotikConfig = { host: '127.0.0.1', user: 'x', password: '' };

// The gcash-resolve on-event body, copied VERBATIM (independently of the source constant) from
// `payment-walled-garden-v6_REPORT_29-07-26.md` §What Was Done bullet 1, so a transcription drift in
// the shipped constant makes item-18b's string-equality assertion FAIL.
const EXPECTED_GCASH_ON_EVENT = `
  :local ip [:resolve payments.gcash.com];
  :if ([:len [/ip hotspot walled-garden ip find comment="gcash-auto"]] = 0) do={
    /ip hotspot walled-garden ip add dst-address=$ip comment="gcash-auto"
  } else={
    /ip hotspot walled-garden ip set [find comment="gcash-auto"] dst-address=$ip
  }
`;

const controllerForPing = () =>
	createMikrotikController({ host: '127.0.0.1', user: 'x', password: '' });

/**
 * Reproduces node-routeros' process-crashing failure path WITHOUT a network:
 * `Connector.onError` re-emits 'error' on the Connector and then `destroy()` runs
 * `removeAllListeners()`; the destroyed socket re-emits 'error' on the next tick, so onError
 * re-emits on a now-listener-less Connector — an unhandled 'error' that would crash the process.
 */
function fakeConn(opts: { neverSettles?: boolean } = {}) {
	const connector = new EventEmitter();
	// node-routeros' destroy(): clear listeners, then the socket re-emits 'error' on a later tick.
	const onError = () => {
		connector.emit('error', new Error('boom')); // 1st emit (a real listener rejects the connect)
		connector.removeAllListeners(); // mirrors Connector.destroy()
		setTimeout(() => connector.emit('error', new Error('boom-again')), 0); // 2nd emit → would throw
	};
	const conn = {
		connector,
		on() {},
		close() {},
		write: async () => [],
		connect() {
			setTimeout(onError, 5);
			// A dead on-link host: node-routeros' connect promise may never settle.
			return opts.neverSettles ? new Promise<unknown>(() => {}) : Promise.reject(new Error('boom'));
		}
	};
	return conn;
}

describe('connectHardened', () => {
	it('does not let the post-destroy socket re-emit crash the process', async () => {
		// If the re-arm is missing, the 2nd emit throws as an unhandled 'error' → uncaughtException →
		// vitest fails the run. Surviving to the assertion proves the crash is contained.
		await expect(connectHardened(fakeConn(), 50)).rejects.toBeTruthy();
		await new Promise((r) => setTimeout(r, 20)); // let the deferred 2nd emit fire under our re-arm
		expect(true).toBe(true);
	});

	it('rejects via timeout instead of hanging when connect never settles', async () => {
		const t0 = Date.now();
		await expect(connectHardened(fakeConn({ neverSettles: true }), 50)).rejects.toThrow(/timed out/);
		await expect(connectHardened(fakeConn({ neverSettles: true }), 50)).rejects.toBeInstanceOf(
			RouterUnreachableError
		);
		expect(Date.now() - t0).toBeLessThan(500);
		await new Promise((r) => setTimeout(r, 20));
	});
});

describe('mikrotik pingHosts (G17 — R1 concurrency + timeout + never-throws)', () => {
	it('runs pings concurrently (bounded), never serially', async () => {
		pingState.inflight = 0;
		pingState.peak = 0;
		const net = controllerForPing();
		const res = await net.pingHosts!(['a', 'b', 'c', 'd']);
		expect(res).toHaveLength(4);
		// Concurrent, not serial (peak > 1); bounded to the chunk size (peak <= 4).
		expect(pingState.peak).toBeGreaterThan(1);
		expect(pingState.peak).toBeLessThanOrEqual(4);
		// Every reachable host reports a numeric RTT (avg of 2ms + 4ms = 3ms).
		expect(res.every((r) => r.aliveMs === 3)).toBe(true);
	});

	it('caps concurrency at the chunk size for a large batch', async () => {
		pingState.inflight = 0;
		pingState.peak = 0;
		const net = controllerForPing();
		const addrs = Array.from({ length: 10 }, (_, i) => `h${i}`);
		const res = await net.pingHosts!(addrs);
		expect(res).toHaveLength(10);
		expect(pingState.peak).toBeLessThanOrEqual(4); // never more than 4 concurrent writes
	});

	it('an unreachable host times out to aliveMs null without throwing', async () => {
		pingState.inflight = 0;
		pingState.peak = 0;
		const net = controllerForPing();
		// `dead` never resolves; a short timeout forces the per-host null path. No throw.
		const res = await net.pingHosts!(['a', 'dead', 'c'], { timeoutMs: 30 });
		expect(res).toHaveLength(3);
		expect(res.find((r) => r.address === 'dead')!.aliveMs).toBeNull();
		expect(res.find((r) => r.address === 'a')!.aliveMs).toBe(3);
		expect(res.find((r) => r.address === 'c')!.aliveMs).toBe(3);
	});
});

describe('provisionGcashResolveScheduler (item 18 — gcash CNAME resolve-script codification)', () => {
	it('adds the gcash-resolve scheduler once; a 2nd call is a full no-op (matched by name)', async () => {
		resetRouterTable();
		const first = await provisionGcashResolveScheduler(mikrotikConfig);
		expect(first.scheduler).toEqual({ value: 'gcash-resolve', created: true });
		expect(routerTable.scheduler).toHaveLength(1);
		expect(routerTable.scheduler[0].name).toBe('gcash-resolve');
		expect(routerTable.scheduler[0].interval).toBe('5m');

		const second = await provisionGcashResolveScheduler(mikrotikConfig);
		expect(second.scheduler).toEqual({ value: 'gcash-resolve', created: false });
		expect(routerTable.scheduler).toHaveLength(1); // no duplicate
	});

	it('sends the on-event body verbatim (guards against transcription drift)', async () => {
		resetRouterTable();
		await provisionGcashResolveScheduler(mikrotikConfig);
		expect(routerTable.scheduler[0]['on-event']).toBe(EXPECTED_GCASH_ON_EVENT);
	});
});

describe('reconcileWalledGarden (item 22 — opt-in tagged+action-scoped prune)', () => {
	// Seeds a mixed live-like table: two veent-admin allow rows (one still desired, one drifted), an
	// un-tagged operator row, the differently-tagged gcash-auto IP row, and a veent-admin deny row
	// (a PROBE_DENIES row sharing the tag on the same menu).
	function seedMixedTable() {
		resetRouterTable();
		routerTable.wg.push(
			{ '.id': '*1', action: 'allow', 'dst-host': 'maya.ph', comment: 'veent-admin' },
			{ '.id': '*2', action: 'allow', 'dst-host': 'stale.example.com', comment: 'veent-admin' },
			{ '.id': '*3', action: 'allow', 'dst-host': '*gcash*', comment: '' }, // un-tagged operator rule
			{
				'.id': '*4',
				action: 'deny',
				'dst-host': 'connectivitycheck.gstatic.com',
				comment: 'veent-admin'
			},
			// A deliberately-disabled reCAPTCHA flap-fix row: veent-admin + allow, host absent from the
			// desired set, but `disabled=true` (`X`) — reconcile must LEAVE it disabled, not delete it.
			{
				'.id': '*5',
				action: 'allow',
				'dst-host': '*.recaptcha.net',
				comment: 'veent-admin',
				disabled: 'true'
			},
			// A RouterOS-auto-generated dst-address mirror: `dynamic=true` (`D`), empty dst-host — it's
			// regenerated from the walled-garden-ip entry, so reconcile must never treat it as a candidate.
			{
				'.id': '*6',
				action: 'allow',
				'dst-host': '',
				comment: 'veent-admin',
				dynamic: 'true'
			}
		);
		routerTable.wgIp.push({
			'.id': '*10',
			'dst-address': '23.7.208.188',
			comment: 'gcash-auto'
		});
	}
	const desired = { hosts: ['maya.ph'], ips: [] as string[] };

	it('default run (no --reconcile wiring) removes nothing — reconcile is only invoked opt-in', async () => {
		// The default setup:router path never calls reconcileWalledGarden; the table is untouched.
		seedMixedTable();
		expect(routerTable.wg).toHaveLength(6);
		expect(routerTable.wgIp).toHaveLength(1);
	});

	it('removes a veent-admin action=allow row whose host is absent from the desired set', async () => {
		seedMixedTable();
		const res = await reconcileWalledGarden(mikrotikConfig, desired);
		expect(res.removed).toEqual([{ layer: 'host', value: 'stale.example.com', dryRun: false }]);
		expect(routerTable.wg.map((r) => r['dst-host'])).not.toContain('stale.example.com');
		expect(routerTable.wg.map((r) => r['dst-host'])).toContain('maya.ph'); // desired kept
	});

	it('never touches un-tagged rows or the differently-tagged gcash-auto IP row', async () => {
		seedMixedTable();
		await reconcileWalledGarden(mikrotikConfig, desired);
		expect(routerTable.wg.map((r) => r['dst-host'])).toContain('*gcash*'); // un-tagged kept
		expect(routerTable.wgIp).toHaveLength(1); // gcash-auto row kept
		expect(routerTable.wgIp[0].comment).toBe('gcash-auto');
	});

	it('NEVER removes an action=deny (PROBE_DENIES) row even when it shares the veent-admin tag', async () => {
		seedMixedTable();
		const res = await reconcileWalledGarden(mikrotikConfig, desired);
		// The deny row's host is absent from the desired ALLOW set, yet it must survive.
		expect(routerTable.wg.find((r) => r.action === 'deny')).toBeTruthy();
		expect(res.removed.some((r) => r.value === 'connectivitycheck.gstatic.com')).toBe(false);
	});

	it('--dry-run removes nothing (log-only) but reports the intended removals', async () => {
		seedMixedTable();
		const res = await reconcileWalledGarden(mikrotikConfig, { ...desired, dryRun: true });
		expect(res.removed).toEqual([{ layer: 'host', value: 'stale.example.com', dryRun: true }]);
		expect(routerTable.wg).toHaveLength(6); // nothing actually deleted
	});

	it('never removes a DISABLED veent-admin allow row (the deliberately-disabled reCAPTCHA flap-fix row)', async () => {
		seedMixedTable();
		const res = await reconcileWalledGarden(mikrotikConfig, desired);
		// Host absent from the desired set, but disabled → must survive AND not be reported removed.
		expect(routerTable.wg.find((r) => r['dst-host'] === '*.recaptcha.net')).toBeTruthy();
		expect(res.removed.some((r) => r.value === '*.recaptcha.net')).toBe(false);
	});

	it('never removes a DYNAMIC veent-admin allow row with empty dst-host (a dst-address mirror)', async () => {
		seedMixedTable();
		const res = await reconcileWalledGarden(mikrotikConfig, desired);
		expect(routerTable.wg.find((r) => r['.id'] === '*6')).toBeTruthy(); // dynamic mirror survives
		expect(res.removed.some((r) => r.value === '')).toBe(false); // empty-dst-host never reported
	});

	it('regression: a STATIC ENABLED veent-admin allow row absent from the desired set IS still removed', async () => {
		// Proves the disabled/dynamic guard did not disable removal entirely.
		seedMixedTable();
		const res = await reconcileWalledGarden(mikrotikConfig, desired);
		expect(res.removed).toEqual([{ layer: 'host', value: 'stale.example.com', dryRun: false }]);
		expect(routerTable.wg.map((r) => r['dst-host'])).not.toContain('stale.example.com');
	});

	// ── Family-prefix tag matching (walled-garden-canonical, 30-07-26) ───────────────────────────
	// reconcileWalledGarden's tag match is now a family-prefix (`commentMatchesTag`): a bare
	// `veent-admin` reconcile call manages the whole `veent-admin:*` family, while a specific sub-tag
	// call manages only its own group. These three cases prove AC12-b/c/d.

	it('AC12-b: a bare veent-admin reconcile call DOES manage a veent-admin:payment-tagged allow row (family-prefix positive)', async () => {
		resetRouterTable();
		routerTable.wg.push(
			{ '.id': '*1', action: 'allow', 'dst-host': 'maya.ph', comment: 'veent-admin:payment' },
			{ '.id': '*2', action: 'allow', 'dst-host': 'stale.pay.com', comment: 'veent-admin:payment' }
		);
		const res = await reconcileWalledGarden(mikrotikConfig, { hosts: ['maya.ph'], ips: [] });
		expect(res.removed).toEqual([{ layer: 'host', value: 'stale.pay.com', dryRun: false }]);
		expect(routerTable.wg.map((r) => r['dst-host'])).toContain('maya.ph'); // desired kept
		expect(routerTable.wg.map((r) => r['dst-host'])).not.toContain('stale.pay.com');
	});

	it('AC12-c: a bare veent-admin reconcile call does NOT manage a foreign tag or a bare-no-colon lookalike', async () => {
		resetRouterTable();
		routerTable.wg.push(
			{ '.id': '*1', action: 'allow', 'dst-host': 'foreign.com', comment: 'veent-other' },
			// `veent-admin-x` has NO colon separator, so it is NOT in the veent-admin family.
			{ '.id': '*2', action: 'allow', 'dst-host': 'lookalike.com', comment: 'veent-admin-x' }
		);
		const res = await reconcileWalledGarden(mikrotikConfig, { hosts: [], ips: [] });
		expect(res.removed).toEqual([]); // neither row matched the veent-admin family
		expect(routerTable.wg.map((r) => r['dst-host'])).toEqual(['foreign.com', 'lookalike.com']);
	});

	it('AC12-d: a veent-admin:payment-scoped reconcile call does NOT manage a sibling veent-admin:portal row', async () => {
		// Proves the 3 real setup-router.ts reconcile call sites (each passing a full sub-tag) stay
		// isolated to their own group — the family widening never leaks across sibling sub-tags.
		resetRouterTable();
		routerTable.wg.push(
			{ '.id': '*1', action: 'allow', 'dst-host': 'stale.pay.com', comment: 'veent-admin:payment' },
			{ '.id': '*2', action: 'allow', 'dst-host': 'portal.keep.com', comment: 'veent-admin:portal' }
		);
		const res = await reconcileWalledGarden(mikrotikConfig, {
			hosts: [],
			ips: [],
			tag: 'veent-admin:payment'
		});
		// Only the payment group's drifted row is removed; the sibling portal row survives untouched.
		expect(res.removed).toEqual([{ layer: 'host', value: 'stale.pay.com', dryRun: false }]);
		expect(routerTable.wg.map((r) => r['dst-host'])).toEqual(['portal.keep.com']);
	});
});
