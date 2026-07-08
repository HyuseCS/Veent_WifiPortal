import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cached, invalidate } from './client';

// The read cache is the seam that (a) dedups concurrent Sentry reads, (b) remembers a failed
// fetch briefly so an outage doesn't cost a fresh 8s timeout on every load, and (c) stays bounded
// so per-issue event keys can't leak. Time is driven by a Date.now() spy; invalidate() isolates
// each case since the cache Map is module-level shared state.

let nowSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	invalidate();
	nowSpy = vi.spyOn(Date, 'now');
});
afterEach(() => {
	nowSpy.mockRestore();
});

describe('cached', () => {
	it('shares one in-flight fetch across concurrent misses (dedup)', async () => {
		let calls = 0;
		let resolveFn!: (v: unknown) => void;
		const fetcher = () => {
			calls++;
			return new Promise<unknown>((res) => (resolveFn = res));
		};
		nowSpy.mockReturnValue(1000);

		const p1 = cached('k', fetcher);
		const p2 = cached('k', fetcher); // hits the in-flight promise, no second call
		expect(calls).toBe(1);

		resolveFn('data');
		await expect(p1).resolves.toBe('data');
		await expect(p2).resolves.toBe('data');
	});

	it('caches a resolved fetch for TTL_MS, then re-fetches once expired', async () => {
		let calls = 0;
		const fetcher = () => Promise.resolve(`v${++calls}`);

		nowSpy.mockReturnValue(1000);
		await expect(cached('r', fetcher)).resolves.toBe('v1');

		nowSpy.mockReturnValue(1000 + 30_000); // still inside the 60s TTL
		await expect(cached('r', fetcher)).resolves.toBe('v1');
		expect(calls).toBe(1);

		nowSpy.mockReturnValue(1000 + 61_000); // past the 60s TTL
		await expect(cached('r', fetcher)).resolves.toBe('v2');
		expect(calls).toBe(2);
	});

	it('remembers a failed fetch only briefly (FAIL_TTL), then retries', async () => {
		let calls = 0;
		const fetcher = () => {
			calls++;
			return Promise.reject(new Error('sentry down'));
		};

		nowSpy.mockReturnValue(1000);
		await expect(cached('f', fetcher)).rejects.toThrow('sentry down');
		// The .catch handler (a microtask, already flushed by the await above) shortened the TTL.

		nowSpy.mockReturnValue(1000 + 5_000); // within the 10s failure window → same rejection, no re-fetch
		await expect(cached('f', fetcher)).rejects.toThrow('sentry down');
		expect(calls).toBe(1);

		nowSpy.mockReturnValue(1000 + 11_000); // past the 10s failure window → re-fetch
		await expect(cached('f', fetcher)).rejects.toThrow('sentry down');
		expect(calls).toBe(2);
	});

	it('stays bounded: evicts oldest entries instead of growing unbounded', async () => {
		let calls = 0;
		const fetcher = () => Promise.resolve(++calls);

		nowSpy.mockReturnValue(5000); // every entry fresh → forces the oldest-eviction path, not expiry
		for (let i = 0; i < 150; i++) await cached(`key-${i}`, fetcher);
		expect(calls).toBe(150); // 150 distinct keys all fetched

		await cached('key-149', fetcher); // newest key survived → still cached
		expect(calls).toBe(150);

		await cached('key-0', fetcher); // oldest key was evicted → must re-fetch
		expect(calls).toBe(151);
	});
});
