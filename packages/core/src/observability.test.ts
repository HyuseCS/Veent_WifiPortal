import { describe, it, expect } from 'vitest';
import { scrubEvent, traceMethods, captureHandled } from './observability';
import type { ErrorEvent } from '@sentry/core';

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

	it('drops secret-keyed values in extra/contexts', () => {
		const e = scrubEvent({
			extra: { password: 'hunter2', authorization: 'Bearer x', otp: '123456', keep: 'ok' }
		} as unknown as ErrorEvent);
		expect(e.extra?.password).toBe('[Filtered]');
		expect(e.extra?.authorization).toBe('[Filtered]');
		expect(e.extra?.otp).toBe('[Filtered]');
		expect(e.extra?.keep).toBe('ok'); // non-secret survives
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
