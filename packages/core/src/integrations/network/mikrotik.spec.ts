import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { connectHardened, createMikrotikController } from './mikrotik';

// ── G17 (R1 / Regression #8): pingHosts concurrency + per-host timeout + never-throws ───────────
// A fake node-routeros connection whose `/ping` write resolves after a short delay, tracking peak
// in-flight concurrency so we can prove pings run in parallel (not serially) yet stay bounded, and
// that an unreachable host times out to `aliveMs: null` without throwing.
const pingState = { inflight: 0, peak: 0 };
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
