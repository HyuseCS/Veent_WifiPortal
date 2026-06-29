import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { getStaffStatus, STAFF_STATUS } from '@veent/core';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { validateEnv } from '$lib/server/validateEnv';

// Fail fast at boot on a misconfigured production deploy (no-op during build; warns in dev).
validateEnv();

/**
 * Baseline security headers for the admin dashboard. It holds owner-privileged, session-cookie'd
 * actions, so it must NEVER be framed (clickjacking on promote/demote/wipe) — hence DENY +
 * `frame-ancestors 'none'`. `nosniff` blocks MIME-confusion; HSTS is set only over HTTPS (the
 * admin VIP may run plain HTTP on the LAN — see SECURITY_RISKS R-cookie note). A full script/style
 * CSP is intentionally out of scope here (would need per-app nonce wiring); this is the framing +
 * sniff baseline the audit flagged as missing.
 */
function setSecurityHeaders(event: Parameters<Handle>[0]['event'], response: Response) {
	const h = response.headers;
	h.set('X-Frame-Options', 'DENY');
	h.set('Content-Security-Policy', "frame-ancestors 'none'");
	h.set('X-Content-Type-Options', 'nosniff');
	h.set('Referrer-Policy', 'same-origin');
	if (event.url.protocol === 'https:') {
		h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}
}

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	// Expose the user to app code ONLY while their staff status is `active`. Status is
	// re-checked on every request here (not just at login), so disabling a staff member
	// takes effect immediately for their live session — across pages AND /api — instead
	// of lingering until the cookie expires. A disabled/pending/profile-less session is
	// left unauthenticated (better-auth's own /api/auth/* routes still run, so sign-out
	// works). Note: getSession already hits the DB; this adds one cheap status read.
	if (session) {
		const status = await getStaffStatus(db, session.user.id);
		if (status === STAFF_STATUS.active) {
			event.locals.session = session.session;
			event.locals.user = session.user;
		}
	}

	const response = await svelteKitHandler({ event, resolve, auth, building });
	setSecurityHeaders(event, response);
	return response;
};

export const handle: Handle = handleBetterAuth;
