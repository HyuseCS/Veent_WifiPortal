import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { auth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { capturePortalContext } from '$lib/server/portal';
import { validateEnv } from '$lib/server/validateEnv';

// Fail fast at boot on a misconfigured production deploy (no-op during build; warns in dev).
validateEnv();

/**
 * Baseline security headers for the captive portal. `frame-ancestors 'self'` / SAMEORIGIN blocks
 * cross-origin framing (clickjacking) without breaking the OS captive popup (which renders the
 * page top-level, not framed). `nosniff` blocks MIME-confusion. HSTS is set only over HTTPS — the
 * portal frequently runs plain HTTP on the LAN, where HSTS would be wrong. A full script/style CSP
 * is out of scope (needs nonce wiring); this is the framing + sniff baseline the audit flagged.
 */
function setSecurityHeaders(event: Parameters<Handle>[0]['event'], response: Response) {
	const h = response.headers;
	h.set('X-Frame-Options', 'SAMEORIGIN');
	h.set('Content-Security-Policy', "frame-ancestors 'self'");
	h.set('X-Content-Type-Options', 'nosniff');
	h.set('Referrer-Policy', 'same-origin');
	if (event.url.protocol === 'https:') {
		h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}
}

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	// Stash the device MAC / callback from the captive-portal redirect before the
	// auth flow's redirects drop the query string.
	capturePortalContext(event);

	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}

	const response = await svelteKitHandler({ event, resolve, auth, building });
	setSecurityHeaders(event, response);
	return response;
};

export const handle: Handle = handleBetterAuth;
