import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit coverage for the M4d Sentry issueId provenance gate in `?/track`.
 *
 * Mocking strategy (VALIDATE Execute-Agent Instruction E1): mock the `$lib/server/sentry` FACADE
 * module directly rather than raw `fetch` + `$env/dynamic/private`. The facade is the only Sentry
 * surface `+page.server.ts` imports, so mocking it exercises the exact branch under test without
 * needing an `$env` mock (which has zero precedent anywhere in this repo).
 *
 * Deliberately NOT mocked: `$lib/server/sentry/map` (`validateSentrySnapshot`) and
 * `$lib/server/formValidation` (`parseDueDate`) — both are pure, so the real implementations give
 * stronger coverage of the surrounding order-of-operations than stubs would.
 */

const fetchLatestEventRaw = vi.fn();
const isSentryConfigured = vi.fn();
const createIssueFromSentry = vi.fn();
const notifyAssignees = vi.fn();
const rateLimit = vi.fn();
const listStaff = vi.fn();

vi.mock('$lib/server/sentry', () => ({
	fetchLatestEventRaw: (...a: unknown[]) => fetchLatestEventRaw(...a),
	isSentryConfigured: () => isSentryConfigured(),
	getDashboard: vi.fn(),
	resolveIssue: vi.fn(),
	ignoreIssue: vi.fn()
}));

vi.mock('$lib/server/db', () => ({ db: {} }));

vi.mock('$lib/server/logger', () => ({
	logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

vi.mock('$lib/server/rateLimit', () => ({
	rateLimit: (...a: unknown[]) => rateLimit(...a),
	clientIp: () => '127.0.0.1'
}));

vi.mock('$lib/server/queries', () => ({ listStaff: (...a: unknown[]) => listStaff(...a) }));

vi.mock('$lib/server/issues', () => ({
	createIssueFromSentry: (...a: unknown[]) => createIssueFromSentry(...a),
	isIssuePriority: (v: string) => ['low', 'medium', 'high', 'critical'].includes(v)
}));

vi.mock('$lib/server/issueNotify', () => ({
	notifyAssignees: (...a: unknown[]) => notifyAssignees(...a)
}));

const { actions } = await import('./+page.server');

/** A well-formed `?/track` submission — every field already passes the pre-existing validation. */
function trackEvent(overrides: Record<string, string> = {}) {
	const form = new FormData();
	const fields: Record<string, string> = {
		sentryIssueId: '1234567890',
		sentryShortId: 'VEENT-ADMIN-1A',
		sentryPermalink: 'https://sentry.io/organizations/veent/issues/1234567890/',
		sentryTitle: 'TypeError: cannot read properties of undefined',
		'issue-title': 'Investigate admin crash',
		'issue-description': 'From Sentry',
		'issue-priority': 'high',
		'issue-dueDate': '',
		...overrides
	};
	for (const [k, v] of Object.entries(fields)) form.set(k, v);

	return {
		locals: { user: { id: 'staff-1', name: 'Staff One' } },
		url: new URL('https://admin.test/sentry'),
		request: { formData: async () => form }
	} as never;
}

/** Invoke the `track:` action, normalizing SvelteKit's `fail()` ActionFailure shape. */
async function track(overrides?: Record<string, string>) {
	const res = (await actions.track(trackEvent(overrides))) as {
		status?: number;
		data?: { action: string; error?: string };
		action?: string;
		ok?: boolean;
		id?: number;
	};
	return res;
}

describe('?/track Sentry issueId provenance gate (M4d)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		rateLimit.mockResolvedValue({ allowed: true });
		listStaff.mockResolvedValue([]);
		createIssueFromSentry.mockResolvedValue(42);
		notifyAssignees.mockResolvedValue(undefined);
		isSentryConfigured.mockReturnValue(true);
	});

	it('should reject a nonexistent sentryIssueId with fail(502) and persist nothing', async () => {
		// Sentry 404s a fabricated id; fetchLatestEventRaw surfaces that as a thrown Error.
		fetchLatestEventRaw.mockRejectedValue(
			new Error('sentry GET /organizations/veent/issues/1234567890/events/latest/ → 404 ')
		);

		const res = await track();

		expect(res.status).toBe(502);
		expect(res.data).toEqual({
			action: 'track',
			error: 'Could not verify this Sentry issue. Try again.'
		});
		expect(fetchLatestEventRaw).toHaveBeenCalledWith('1234567890');
		expect(createIssueFromSentry).not.toHaveBeenCalled();
		expect(notifyAssignees).not.toHaveBeenCalled();
	});

	it('should reject an org-mismatch sentryIssueId with fail(502) and persist nothing', async () => {
		// A real id owned by a DIFFERENT org: the org-scoped path 404s identically to a fabricated
		// id — one branch by design, so the caller cannot use the response as an org-membership
		// oracle.
		fetchLatestEventRaw.mockRejectedValue(
			new Error('sentry GET /organizations/veent/issues/9999999999/events/latest/ → 404 ')
		);

		const res = await track({ sentryIssueId: '9999999999' });

		expect(res.status).toBe(502);
		expect(res.data?.error).toBe('Could not verify this Sentry issue. Try again.');
		expect(createIssueFromSentry).not.toHaveBeenCalled();
	});

	it('should fail closed (fail(502)) when the provenance lookup times out or errors while Sentry is configured', async () => {
		// AbortController timeout / 5xx / network failure all reach the caller as a throw.
		fetchLatestEventRaw.mockRejectedValue(
			Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
		);

		const res = await track();

		expect(res.status).toBe(502);
		expect(res.data?.error).toBe('Could not verify this Sentry issue. Try again.');
		expect(createIssueFromSentry).not.toHaveBeenCalled();
		expect(notifyAssignees).not.toHaveBeenCalled();
	});

	it('should skip the provenance check and track unchanged when Sentry is not configured', async () => {
		isSentryConfigured.mockReturnValue(false);

		const res = await track();

		expect(fetchLatestEventRaw).not.toHaveBeenCalled();
		expect(res).toMatchObject({ action: 'track', ok: true, id: 42 });
		expect(createIssueFromSentry).toHaveBeenCalledTimes(1);
	});

	it('should create the incident on a resolvable sentryIssueId (happy path unchanged)', async () => {
		fetchLatestEventRaw.mockResolvedValue({ id: 'evt-1', title: 'TypeError' });

		const res = await track();

		expect(fetchLatestEventRaw).toHaveBeenCalledWith('1234567890');
		expect(res).toMatchObject({ action: 'track', ok: true, id: 42 });
		expect(createIssueFromSentry).toHaveBeenCalledTimes(1);
		const [, snapshot, input, userId] = createIssueFromSentry.mock.calls[0];
		expect(snapshot).toMatchObject({ issueId: '1234567890', shortId: 'VEENT-ADMIN-1A' });
		expect(input).toMatchObject({ title: 'Investigate admin crash', priority: 'high' });
		expect(userId).toBe('staff-1');
	});

	it('should run the provenance check before the remaining field validation (reject early, persist late)', async () => {
		// A fabricated id must not even reach title validation — proves gate ordering.
		fetchLatestEventRaw.mockRejectedValue(new Error('sentry GET … → 404 '));

		const res = await track({ 'issue-title': '' });

		expect(res.status).toBe(502);
		expect(res.data?.error).toBe('Could not verify this Sentry issue. Try again.');
	});

	it('should reject a malformed snapshot before making any Sentry call', async () => {
		// validateSentrySnapshot (real, pure) still runs first — no wasted round trip.
		const res = await track({ sentryPermalink: 'javascript:alert(1)' });

		expect(res.status).toBe(400);
		expect(res.data?.error).toBe('Invalid Sentry permalink.');
		expect(fetchLatestEventRaw).not.toHaveBeenCalled();
	});
});
