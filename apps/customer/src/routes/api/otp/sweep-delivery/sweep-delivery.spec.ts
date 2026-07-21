import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Sweep cron for OTP delivery status. The behaviour that matters here is CONSERVATISM: only a
 * confirmed carrier rejection may alert, everything else is transient. A trigger-happy classifier
 * would page on every flaky status call; a silent one is the bug this whole feature exists to fix.
 *
 * `requireCron` is deliberately NOT mocked — the auth-guard test must exercise the real
 * timing-safe comparison, so CRON_SECRET is set through the env mock instead.
 */

const state = vi.hoisted(() => ({
	env: { CRON_SECRET: 'test-cron-secret', CAST_API_KEY: 'cast_test_key' } as Record<
		string,
		string | undefined
	>,
	// Rows the sweep SELECT returns.
	pending: [] as Array<Record<string, unknown>>,
	// Rows the "aged out" UPDATE ... RETURNING reports.
	agedOut: [] as Array<{ id: number }>,
	// Rows the 48h prune DELETE ... RETURNING reports.
	purged: [] as Array<{ id: number }>,
	// Flip to make the per-row status UPDATE blow up (proves the sweep survives a bad row).
	updateThrows: false
}));

vi.mock('$app/environment', () => ({ dev: false, browser: false, building: false }));
vi.mock('$env/dynamic/private', () => ({
	get env() {
		return state.env;
	}
}));
vi.mock('@veent/db/schema', () => ({
	customerOtpDeliveryLog: {
		id: 'id',
		provider: 'provider',
		status: 'status',
		createdAt: 'created_at'
	}
}));
vi.mock('@veent/core', () => ({ captureHandled: vi.fn() }));

const setStatus = vi.hoisted(() => vi.fn());
const deleteWhere = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => ({ from: () => ({ where: async () => state.pending }) }),
		update: () => ({
			set: (values: { status: string }) => {
				setStatus(values);
				return {
					where: (...args: unknown[]) => {
						if (state.updateThrows) throw new Error('update failed');
						// The per-row 'rejected' update is awaited directly; the aged-out
						// 'unknown' update chains .returning(). Support both shapes.
						const result = Promise.resolve(
							values.status === 'unknown' ? state.agedOut : []
						) as Promise<unknown> & { returning: () => Promise<unknown> };
						result.returning = async () => state.agedOut;
						void args;
						return result;
					}
				};
			}
		}),
		delete: () => ({
			where: (...args: unknown[]) => {
				deleteWhere(...args);
				return { returning: async () => state.purged };
			}
		})
	}
}));

import { POST } from './+server';
import { captureHandled } from '@veent/core';

const MINUTE = 60 * 1000;

/** A Cast row accepted `agoMs` ago and still awaiting a delivery verdict. */
function pendingRow(id: number, agoMs = MINUTE, messageId = `CAST${id}`) {
	return {
		id,
		provider: 'cast',
		providerMessageId: messageId,
		phoneMasked: '+63 ••• ••• 4567',
		status: 'pending',
		createdAt: new Date(Date.now() - agoMs)
	};
}

function event(secret: string | null = 'test-cron-secret') {
	const headers = new Headers();
	if (secret !== null) headers.set('x-cron-secret', secret);
	return {
		request: new Request('http://localhost/api/otp/sweep-delivery', { method: 'POST', headers }),
		getClientAddress: () => '127.0.0.1'
	} as never;
}

/** Cast DLR status response. */
function mockStatus(body: unknown, ok = true) {
	const fn = vi.fn().mockResolvedValue({ ok, json: async () => body } as Response);
	vi.stubGlobal('fetch', fn);
	return fn;
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.unstubAllGlobals();
	state.env = { CRON_SECRET: 'test-cron-secret', CAST_API_KEY: 'cast_test_key' };
	state.pending = [];
	state.agedOut = [];
	state.purged = [];
	state.updateThrows = false;
});

describe('POST /api/otp/sweep-delivery — auth guard', () => {
	it('rejects a request with no x-cron-secret header', async () => {
		await expect(POST(event(null))).rejects.toMatchObject({ status: 401 });
	});

	it('rejects a request with the wrong secret', async () => {
		await expect(POST(event('wrong'))).rejects.toMatchObject({ status: 401 });
	});

	it('accepts a request with the correct secret', async () => {
		const res = await POST(event());
		expect(res.status).toBe(200);
	});
});

describe('POST /api/otp/sweep-delivery — classification', () => {
	it('(d) marks a REJECTD row rejected and alerts exactly once', async () => {
		state.pending = [pendingRow(1)];
		mockStatus({ dlr_status: 'REJECTD' });

		const body = await (await POST(event())).json();

		expect(body).toMatchObject({ checked: 1, rejected: 1 });
		expect(setStatus).toHaveBeenCalledWith({ status: 'rejected' });
		expect(captureHandled).toHaveBeenCalledTimes(1);
	});

	it('(d) marks an "undelivered" row rejected and alerts', async () => {
		state.pending = [pendingRow(1)];
		mockStatus({ status: 'undelivered' });

		const body = await (await POST(event())).json();

		expect(body.rejected).toBe(1);
		expect(captureHandled).toHaveBeenCalledTimes(1);
	});

	it.each([
		['delivered', { dlr_status: 'DELIVRD' }],
		['still pending', { dlr_status: 'PENDING' }],
		['an unrecognized string', { dlr_status: 'WEIRD_NEW_CODE' }],
		['a missing field', {}],
		['a null body', null]
	])('(d) leaves a row pending and does NOT alert for %s', async (_label, statusBody) => {
		state.pending = [pendingRow(1)];
		mockStatus(statusBody);

		const body = await (await POST(event())).json();

		expect(body.rejected).toBe(0);
		expect(setStatus).not.toHaveBeenCalledWith({ status: 'rejected' });
		expect(captureHandled).not.toHaveBeenCalled();
	});

	it('(e) treats a non-2xx status response as transient, never a rejection', async () => {
		state.pending = [pendingRow(1)];
		mockStatus({ dlr_status: 'REJECTD' }, false); // 500-ish: body must be ignored entirely

		const body = await (await POST(event())).json();

		expect(body.rejected).toBe(0);
		expect(captureHandled).not.toHaveBeenCalled();
	});

	it('(e) treats a network error as transient, never a rejection', async () => {
		state.pending = [pendingRow(1)];
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));

		const body = await (await POST(event())).json();

		expect(body.rejected).toBe(0);
		// The per-row failure is logged for visibility, but never as a delivery rejection.
		expect(captureHandled).not.toHaveBeenCalledWith(
			expect.objectContaining({ message: 'OTP delivery rejected by carrier' }),
			expect.anything()
		);
	});

	it('skips a row with no provider message id without calling Cast', async () => {
		state.pending = [pendingRow(1, MINUTE, null as unknown as string)];
		const fetchFn = mockStatus({ dlr_status: 'REJECTD' });

		const body = await (await POST(event())).json();

		expect(fetchFn).not.toHaveBeenCalled();
		expect(body).toMatchObject({ checked: 0, rejected: 0 });
	});
});

describe('POST /api/otp/sweep-delivery — fingerprint stability', () => {
	it('(f) emits a byte-identical Error message across two different message ids', async () => {
		state.pending = [
			pendingRow(1, MINUTE, 'CAST_AAA'),
			{ ...pendingRow(2, MINUTE, 'CAST_ZZZ'), phoneMasked: '+63 ••• ••• 9999' }
		];
		mockStatus({ dlr_status: 'REJECTD' });

		await POST(event());

		expect(captureHandled).toHaveBeenCalledTimes(2);
		const [first, second] = (captureHandled as ReturnType<typeof vi.fn>).mock.calls;
		// Same title => Sentry groups a total outage into ONE rising-count issue rather than
		// thousands of singletons that bury the alert.
		expect((first[0] as Error).message).toBe('OTP delivery rejected by carrier');
		expect((second[0] as Error).message).toBe((first[0] as Error).message);
		// The variable data still reaches Sentry — just via `extra`, which is not fingerprinted.
		expect(first[1].extra).toEqual({
			providerMessageId: 'CAST_AAA',
			phoneMasked: '+63 ••• ••• 4567'
		});
		expect(second[1].extra.providerMessageId).toBe('CAST_ZZZ');
	});

	it('never puts a raw phone number in the Sentry payload', async () => {
		state.pending = [pendingRow(1)];
		mockStatus({ dlr_status: 'REJECTD' });

		await POST(event());

		const payload = JSON.stringify((captureHandled as ReturnType<typeof vi.fn>).mock.calls[0][1]);
		expect(payload).not.toMatch(/\+?639\d{9}/);
	});
});

describe('POST /api/otp/sweep-delivery — 30-minute give-up bound', () => {
	it('only sweeps rows inside the 30-minute window', async () => {
		// The window is enforced in the SELECT predicate; assert the handler reports the aged-out
		// rows the UPDATE matched rather than trying to sweep them.
		state.pending = [];
		state.agedOut = [{ id: 7 }, { id: 8 }];
		mockStatus({ dlr_status: 'REJECTD' });

		const body = await (await POST(event())).json();

		expect(body).toMatchObject({ checked: 0, unknown: 2 });
	});

	it('transitions an aged-out row to unknown and fires NO alert', async () => {
		state.agedOut = [{ id: 7 }];
		mockStatus({});

		await POST(event());

		expect(setStatus).toHaveBeenCalledWith({ status: 'unknown' });
		expect(captureHandled).not.toHaveBeenCalled();
	});
});

describe('POST /api/otp/sweep-delivery — retention prune', () => {
	it('prunes rows older than 48h on a clean run', async () => {
		state.purged = [{ id: 1 }, { id: 2 }, { id: 3 }];

		const body = await (await POST(event())).json();

		expect(deleteWhere).toHaveBeenCalledTimes(1);
		expect(body.pruned).toBe(3);
	});

	it('still prunes when the sweep loop throws mid-iteration', async () => {
		// Otherwise masked-phone rows would pile up precisely when the sweep is broken.
		state.pending = [pendingRow(1)];
		state.purged = [{ id: 99 }];
		state.updateThrows = true;
		mockStatus({ dlr_status: 'REJECTD' });

		const body = await (await POST(event())).json();

		expect(deleteWhere).toHaveBeenCalledTimes(1);
		expect(body.pruned).toBe(1);
	});

	it('still prunes when every status call fails', async () => {
		state.pending = [pendingRow(1), pendingRow(2)];
		state.purged = [{ id: 99 }];
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('cast down')));

		const body = await (await POST(event())).json();

		expect(deleteWhere).toHaveBeenCalledTimes(1);
		expect(body.pruned).toBe(1);
	});
});
