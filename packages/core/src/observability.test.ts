import { describe, it, expect } from 'vitest';
import { scrubEvent, traceMethods, captureHandled, sentryOptions } from './observability';
import type { ErrorEvent, TransactionEvent, EventHint } from '@sentry/core';
import { RouterUnreachableError } from './integrations/network/types';

// The scrubber is the privacy safety net — if it regresses, PII ships to Sentry. Assert the
// masking + secret-drop + request-strip behaviours that matter.
describe('scrubEvent', () => {
	it('masks email, MAC, and phone inside a message', () => {
		const e = scrubEvent({
			message: 'user juan@example.com on AA:BB:CC:DD:EE:FF phoned +639171234567'
		} as ErrorEvent);
		expect(e.message).not.toContain('juan@example.com');
		expect(e.message).not.toContain('DD:EE:FF');
		expect(e.message).not.toContain('9171234567');
		expect(e.message).toContain('•••');
	});

	it('masks all three MAC forms (colon, hyphen, bare 12-hex), keeping the vendor prefix', () => {
		// Router log lines carry MACs in any of these shapes — all must be redacted.
		expect(scrubEvent({ message: 'dev AA:BB:CC:DD:EE:FF' } as ErrorEvent).message).toBe('dev AA:BB:CC•••');
		expect(scrubEvent({ message: 'dev AA-BB-CC-DD-EE-FF' } as ErrorEvent).message).toBe('dev AA-BB-CC•••');
		expect(scrubEvent({ message: 'dev AABBCCDDEEFF' } as ErrorEvent).message).toBe('dev AABBCC•••');
	});

	it('leaves non-MAC hex runs and mixed separators untouched', () => {
		// 11- and 13-hex are not MACs; a mixed-separator run is not a real MAC either.
		expect(scrubEvent({ message: 'id AABBCCDDEEF' } as ErrorEvent).message).toBe('id AABBCCDDEEF');
		expect(scrubEvent({ message: 'id AABBCCDDEEFFA' } as ErrorEvent).message).toBe('id AABBCCDDEEFFA');
		expect(scrubEvent({ message: 'id AA:BB-CC:DD-EE:FF' } as ErrorEvent).message).toBe('id AA:BB-CC:DD-EE:FF');
	});

	it('masks PH phone shapes as phones, not MACs', () => {
		// +639171234567 is 12 digit-only chars — the old bare-MAC branch swallowed it and exposed
		// the carrier prefix (+639171•••). All PH variants must mask with the phone shape instead.
		expect(scrubEvent({ message: 'call +639171234567' } as ErrorEvent).message).toBe('call +63•••67');
		expect(scrubEvent({ message: 'call 09171234567' } as ErrorEvent).message).toBe('call 091•••67');
		expect(scrubEvent({ message: 'call 0917 123 4567' } as ErrorEvent).message).toBe('call 091•••67');
		expect(scrubEvent({ message: 'call 0917-123-4567' } as ErrorEvent).message).toBe('call 091•••67');
		expect(scrubEvent({ message: 'call +63 917 123 4567' } as ErrorEvent).message).toBe('call +63•••67');
	});

	it('leaves timestamps, amounts, and numeric ids unmasked', () => {
		// The old generic ≥9-digit rule rewrote these to first3•••last2, garbling every event.
		expect(scrubEvent({ message: 'ts 1782969590415' } as ErrorEvent).message).toBe('ts 1782969590415');
		expect(scrubEvent({ message: 'paid 150000 centavos' } as ErrorEvent).message).toBe('paid 150000 centavos');
		expect(scrubEvent({ message: 'checkout 9876543210' } as ErrorEvent).message).toBe('checkout 9876543210');
	});

	it('still masks an all-digit bare MAC via the 12-digit catch-all', () => {
		// No hex letters, so MAC_RE skips it — the PHONE_RE catch-all must pick it up so nothing
		// previously masked ships unmasked.
		const m = scrubEvent({ message: 'dev 001122334455' } as ErrorEvent).message as string;
		expect(m).not.toContain('001122334455');
		expect(m).toContain('•••');
	});

	it('drops secret-keyed values in extra/contexts', () => {
		const e = scrubEvent({
			extra: { password: 'hunter2', authorization: 'Bearer x', otp: '123456', keep: 'ok' }
		} as unknown as ErrorEvent);
		expect(e.extra?.password).toBe('[Filtered]');
		expect(e.extra?.authorization).toBe('[Filtered]');
		expect(e.extra?.otp).toBe('[Filtered]');
		expect(e.extra?.keep).toBe('ok'); // non-secret survives
	});

	it('masks PII inside transaction spans (the beforeSendTransaction payload)', () => {
		// The SDK's fetch instrumentation writes the FULL query string into span data on every
		// sampled __data.json fetch — the exact shape that leaked MACs before spans were scrubbed.
		const e = scrubEvent({
			type: 'transaction',
			transaction: 'GET /dashboard',
			spans: [
				{
					description: 'GET http://portal.local/login?mac=AA:BB:CC:DD:EE:FF',
					data: {
						'http.url': 'http://portal.local/dashboard/__data.json?mac=AA%3ABB%3ACC%3ADD%3AEE%3AFF',
						'http.query': 'mac=AA%3ABB%3ACC%3ADD%3AEE%3AFF&email=juan%40example.com'
					}
				}
			]
		} as unknown as TransactionEvent);
		const span = (e as TransactionEvent).spans![0] as unknown as {
			description: string;
			data: Record<string, string>;
		};
		expect(span.description).not.toContain('DD:EE:FF');
		expect(span.data['http.url']).not.toContain('DD%3AEE');
		expect(span.data['http.query']).not.toContain('DD%3AEE');
		expect(span.data['http.query']).not.toContain('juan%40');
	});

	it('masks percent-encoded MACs and emails in plain strings', () => {
		const e = scrubEvent({
			message: 'redirect /login?mac=AA%3ABB%3ACC%3ADD%3AEE%3AFF&e=juan%40example.com'
		} as ErrorEvent);
		expect(e.message).not.toContain('DD%3AEE');
		expect(e.message).not.toContain('juan%40');
		expect(e.message).toContain('AA%3ABB%3ACC•••'); // vendor prefix kept, device octets gone
	});

	it('leaves a parameterized transaction name byte-identical (protects issue grouping)', () => {
		const e = scrubEvent({
			type: 'transaction',
			transaction: 'GET /top-up/[id]'
		} as unknown as TransactionEvent);
		expect(e.transaction).toBe('GET /top-up/[id]');
	});

	it('strips request cookies, auth headers, body, and user IP', () => {
		const e = scrubEvent({
			request: {
				url: 'https://admin/users?email=juan@example.com',
				query_string: 'email=juan@example.com',
				cookies: { session: 'abc' },
				headers: { Cookie: 'x', Authorization: 'Bearer y', 'user-agent': 'ua' },
				data: { email: 'a@b.com' }
			},
			user: { id: 'u1', ip_address: '1.2.3.4', email: 'a@b.com' }
		} as unknown as ErrorEvent);
		expect(e.request?.cookies).toBeUndefined();
		expect(e.request?.headers?.Cookie).toBeUndefined();
		expect(e.request?.headers?.Authorization).toBeUndefined();
		expect(e.request?.headers?.['user-agent']).toBe('ua'); // non-sensitive header kept
		expect(e.request?.data).toBeUndefined();
		// PII surviving in the URL / query-string is masked, not shipped verbatim.
		expect(e.request?.url).not.toContain('juan@example.com');
		expect((e.request as { query_string?: string })?.query_string).not.toContain('juan@example.com');
		expect(e.user?.id).toBe('u1'); // id kept — the useful signal
		expect(e.user?.ip_address).toBeUndefined();
		expect(e.user?.email).toBeUndefined();
	});
});

describe('sentryOptions', () => {
	it('clamps tracesSampleRate to [0, 1], falling back to 0.2', () => {
		const rate = (r: number) =>
			sentryOptions({ app: 'customer', tracesSampleRate: r }).tracesSampleRate;
		// Invalid env-derived values (NaN from Number('garbage'), out-of-range) → default.
		expect(rate(NaN)).toBe(0.2);
		expect(rate(Number('garbage'))).toBe(0.2);
		expect(rate(-1)).toBe(0.2);
		expect(rate(5)).toBe(0.2);
		expect(rate(Infinity)).toBe(0.2);
		// Valid configurations pass through untouched (incl. the hooks' dev override of 1.0).
		expect(rate(0)).toBe(0);
		expect(rate(0.2)).toBe(0.2);
		expect(rate(1)).toBe(1);
	});

	// beforeSend classification: router-unreachable timeouts are downgraded to `warning` (not
	// dropped) so they stop cluttering the error stream — the cron withMonitor check-in already
	// alerts on the sweep failure. scrubEvent MUST still run on every branch.
	const beforeSend = (event: ErrorEvent, hint: EventHint) => {
		const opts = sentryOptions({ app: 'customer', tracesSampleRate: 0.2 });
		return opts.beforeSend(event, hint) as ErrorEvent;
	};

	it('Case A: downgrades RouterUnreachableError to warning via hint.originalException, PII still scrubbed', () => {
		const event = {
			message: 'router died for juan@example.com'
		} as ErrorEvent;
		const hint = {
			originalException: new RouterUnreachableError('connect timed out after 5000ms')
		} as EventHint;
		const out = beforeSend(event, hint);
		expect(out.level).toBe('warning');
		// PII scrub runs on the matched (downgraded) branch.
		expect(out.message).not.toContain('juan@example.com');
		expect(out.message).toContain('•••');
	});

	it('Case B: leaves a normal Error untouched, PII still scrubbed', () => {
		const event = {
			message: 'normal bug for juan@example.com'
		} as ErrorEvent;
		const hint = { originalException: new Error('normal bug') } as EventHint;
		const out = beforeSend(event, hint);
		// Level unchanged — a real bug stays at error level (input had no level → stays undefined).
		expect(out.level).toBeUndefined();
		// PII scrub runs on the unmatched branch too.
		expect(out.message).not.toContain('juan@example.com');
		expect(out.message).toContain('•••');
	});

	it('Case C: downgrades via event.exception.values[0].type fallback when hint is absent', () => {
		const event = {
			exception: { values: [{ type: 'RouterUnreachableError', value: 'timed out' }] }
		} as ErrorEvent;
		const out = beforeSend(event, {} as EventHint);
		expect(out.level).toBe('warning');
	});
});

describe('captureHandled', () => {
	it('never throws when Sentry is inactive (fail-open)', () => {
		expect(() => captureHandled(new Error('boom'))).not.toThrow();
		expect(() => captureHandled('a string error', { level: 'error' })).not.toThrow();
		expect(() => captureHandled({ weird: 'object' }, { tags: { area: 'test' } })).not.toThrow();
		expect(captureHandled(new Error('x'))).toBeUndefined();
	});
});

describe('traceMethods', () => {
	it('passes through return values and non-function props with Sentry inactive', async () => {
		const provider = {
			name: 'stub',
			async greet(who: string) {
				return `hi ${who}`;
			}
		};
		const traced = traceMethods(provider, 'test.stub', 'test');
		expect(traced.name).toBe('stub'); // non-function prop copied
		await expect(traced.greet('maya')).resolves.toBe('hi maya'); // call still works
	});
});
