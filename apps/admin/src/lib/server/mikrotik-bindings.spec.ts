import { describe, it, expect } from 'vitest';
import {
	isAdminBypassComment,
	commentMatchesTag,
	adminBypassComment,
	adminBypassExpired,
	planGrant,
	ADMIN_BYPASS_TAG,
	GUEST_BYPASS_TAG,
	type BindingRow
} from '@veent/core';

/**
 * The tag-aware binding rules that keep guest and admin bypasses from clobbering each other, and
 * that expire admin bypasses at the 4h cap. These are the security-critical decisions; the thin
 * router-command execution around them is verified on the bench MikroTik (see the plan's matrix).
 */

describe('isAdminBypassComment', () => {
	it('matches bare and timestamped admin comments only', () => {
		expect(isAdminBypassComment('veent-admin')).toBe(true);
		expect(isAdminBypassComment('veent-admin:1700000000000')).toBe(true);
		expect(isAdminBypassComment('veent-portal')).toBe(false);
		expect(isAdminBypassComment('veent-checkout:123')).toBe(false);
		expect(isAdminBypassComment('veent-admin-extra')).toBe(false); // not a tag-family member
		expect(isAdminBypassComment('')).toBe(false);
	});
});

describe('commentMatchesTag', () => {
	it('matches a tag exactly or as a `tag:<suffix>` family member', () => {
		expect(commentMatchesTag('veent-portal', GUEST_BYPASS_TAG)).toBe(true);
		expect(commentMatchesTag('veent-admin', ADMIN_BYPASS_TAG)).toBe(true);
		expect(commentMatchesTag('veent-admin:1700000000000', ADMIN_BYPASS_TAG)).toBe(true);
		// Cross-tag never matches — this is what stops a guest revoke stripping an admin binding.
		expect(commentMatchesTag('veent-admin:1', GUEST_BYPASS_TAG)).toBe(false);
		expect(commentMatchesTag('veent-portal', ADMIN_BYPASS_TAG)).toBe(false);
	});
});

describe('adminBypassComment', () => {
	it('stamps the epoch onto the admin tag', () => {
		expect(adminBypassComment(1700000000000)).toBe('veent-admin:1700000000000');
	});
});

describe('adminBypassExpired', () => {
	const HOUR = 60 * 60_000;
	const maxAge = 4 * HOUR;

	it('expires a timestamped admin binding at/after the cap, not before', () => {
		const created = 1_000_000_000_000;
		expect(adminBypassExpired(`veent-admin:${created}`, created + maxAge, maxAge)).toBe(true);
		expect(adminBypassExpired(`veent-admin:${created}`, created + maxAge - 1, maxAge)).toBe(false);
		expect(adminBypassExpired(`veent-admin:${created}`, created + 2 * HOUR, maxAge)).toBe(false);
	});

	it('grandfathers bare / malformed / non-ours comments (never reaped)', () => {
		const now = 2_000_000_000_000;
		expect(adminBypassExpired('veent-admin', now, maxAge)).toBe(false); // legacy standing bypass
		expect(adminBypassExpired('veent-admin:abc', now, maxAge)).toBe(false); // unparseable
		expect(adminBypassExpired('veent-admin:', now, maxAge)).toBe(false); // empty stamp → 0
		expect(adminBypassExpired('veent-admin:-5', now, maxAge)).toBe(false); // non-positive
		expect(adminBypassExpired('veent-portal', now, maxAge)).toBe(false); // guest binding
	});
});

describe('planGrant — mutual-exclusion precedence', () => {
	const NOW = 1_700_000_000_000;
	const bypassed = (comment: string): BindingRow => ({ '.id': '*1', comment, type: 'bypassed' });
	const regular = (comment: string): BindingRow => ({ '.id': '*2', comment, type: 'regular' });

	// ── admin grant ────────────────────────────────────────────────────────────
	it('admin grant on an empty MAC adds a stamped admin binding and flushes', () => {
		expect(planGrant([], { isAdmin: true, nowMs: NOW, guestTag: ADMIN_BYPASS_TAG })).toEqual({
			action: 'add',
			comment: `veent-admin:${NOW}`,
			flush: true
		});
	});

	it('admin re-grant slides its own binding forward WITHOUT a flush (no churn)', () => {
		const plan = planGrant([bypassed('veent-admin:100')], {
			isAdmin: true,
			nowMs: NOW,
			guestTag: ADMIN_BYPASS_TAG
		});
		expect(plan).toEqual({ action: 'set', id: '*1', comment: `veent-admin:${NOW}`, flush: false });
	});

	it('admin grant NO-OPS on a device already bypassed by a guest binding (paid time kept)', () => {
		expect(
			planGrant([bypassed('veent-portal')], { isAdmin: true, nowMs: NOW, guestTag: ADMIN_BYPASS_TAG })
		).toEqual({ action: 'noop' });
	});

	it('admin grant finds its binding even when it is not rows[0] (multi-row drift)', () => {
		const rows = [regular('something'), bypassed('veent-admin:100')];
		const plan = planGrant(rows, { isAdmin: true, nowMs: NOW, guestTag: ADMIN_BYPASS_TAG });
		expect(plan).toEqual({ action: 'set', id: '*1', comment: `veent-admin:${NOW}`, flush: false });
	});

	// ── guest grant ────────────────────────────────────────────────────────────
	it('guest grant NO-OPS when an admin binding exists (never demotes it), even at rows[1]', () => {
		const rows = [regular('x'), bypassed('veent-admin:100')];
		expect(planGrant(rows, { isAdmin: false, nowMs: NOW, guestTag: GUEST_BYPASS_TAG })).toEqual({
			action: 'noop'
		});
	});

	it('guest grant is idempotent on an already-bypassed portal binding (no re-flush)', () => {
		expect(
			planGrant([bypassed('veent-portal')], {
				isAdmin: false,
				nowMs: NOW,
				guestTag: GUEST_BYPASS_TAG
			})
		).toEqual({ action: 'noop' });
	});

	it('guest grant on an empty MAC adds a portal binding and flushes', () => {
		expect(planGrant([], { isAdmin: false, nowMs: NOW, guestTag: GUEST_BYPASS_TAG })).toEqual({
			action: 'add',
			comment: 'veent-portal',
			flush: true
		});
	});

	it('guest grant promotes a non-bypassed portal row to bypassed and flushes', () => {
		expect(
			planGrant([regular('veent-portal')], {
				isAdmin: false,
				nowMs: NOW,
				guestTag: GUEST_BYPASS_TAG
			})
		).toEqual({ action: 'set', id: '*2', comment: 'veent-portal', flush: true });
	});
});
