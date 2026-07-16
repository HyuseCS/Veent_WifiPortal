import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { connectHardened } from './mikrotik';

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
