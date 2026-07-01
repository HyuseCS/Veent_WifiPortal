import { redirect, error } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { auth } from '$lib/server/auth';
import { rateLimit, clientIp } from '$lib/server/rateLimit';
import type { RequestHandler } from './$types';

/**
 * GET /auth/handoff?token=… — the CNA→browser session handoff (Issue 2b, mechanism B).
 *
 * The captive-network-assistant webview (separate, sandboxed cookie jar) generates a one-time
 * token for its authenticated session and offers an "Open in your browser" link carrying it.
 * When the guest opens that link in their real system browser, this route verifies + CONSUMES
 * the token (better-auth's oneTimeToken plugin — single-use, short-TTL, hashed at rest) and
 * mints a session here, so they skip a second OTP. The session cookie is applied to THIS
 * response by the sveltekitCookies plugin (same bridge the OTP-verify path uses).
 *
 * Security:
 *  - never trust network identity — this path requires possessing the token (defeats T2/T4/T5),
 *  - per-IP rate limit to blunt token enumeration (tokens are random + single-use + ≤2min, so
 *    brute force is already infeasible; this is defense in depth),
 *  - the raw token is NEVER logged,
 *  - the token is STRIPPED from the URL via a redirect to a clean path after consumption, so it
 *    can't linger in history / referrer / server logs.
 */
export const GET: RequestHandler = async (event) => {
	const token = event.url.searchParams.get('token');
	// No token → just send them to the normal login (nothing to consume).
	if (!token) throw redirect(303, '/login');

	const gate = await rateLimit('auth_handoff_ip', clientIp(event), 30, 60_000);
	if (!gate.allowed) error(429, 'Too many requests');

	try {
		// Verifies + invalidates the single-use token and mints a session; the cookie is set on
		// this response via sveltekitCookies. Pass headers so the plugin has the request context.
		await auth.api.verifyOneTimeToken({
			body: { token },
			headers: event.request.headers
		});
	} catch (e) {
		// Expired / already-consumed / unknown token. Don't leak which — send to login with a
		// neutral flag so the page can show "that link expired, please log in".
		if (e instanceof APIError) throw redirect(303, '/login?handoff=expired');
		throw e;
	}

	// Strip the token from the URL (no referrer/history/log leak); the session cookie is already
	// set on this redirect response.
	throw redirect(303, '/dashboard');
};
