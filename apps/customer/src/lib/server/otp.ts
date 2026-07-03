import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * OTP support for the captive portal.
 *
 * better-auth's phoneNumber plugin owns the code itself (generation, expiry,
 * attempt limiting, verification). This module only handles the two things the
 * plugin doesn't:
 *
 *   1. `sendOtp` — THE single SMS delivery seam (wired into the plugin's sendOTP).
 *   2. A signed, httpOnly "pending verification" cookie that remembers which
 *      phone/intent/name we're verifying across the redirect to /auth/verify —
 *      so the number never rides in the URL and can't be swapped by the client.
 */

export const PENDING_COOKIE = 'veent-portal-verify';
export const PENDING_MAX_AGE = 5 * 60; // seconds; matches the OTP expiry

/**
 * Whether the pending-verification cookie is set `Secure`. Pinned to the ORIGIN protocol
 * (NOT `!dev`/NODE_ENV) to match the better-auth session cookies (`auth.ts` `useSecureCookies`).
 * A LAN-appliance deploy legitimately serves the portal over http:// (allowed by `validateEnv`);
 * a `Secure` cookie is dropped by the browser over http, which would leave the login → /auth/verify
 * handoff unable to read the pending cookie and bounce the guest back to /login forever.
 */
export const PENDING_COOKIE_SECURE = (env.ORIGIN ?? '').startsWith('https://');

export type OtpIntent = 'login' | 'register';

export interface PendingVerification {
	phone: string; // E.164, e.g. +639171234567
	intent: OtpIntent;
	name?: string; // carried from the register form
	mac?: string; // captive-portal device MAC, carried through to the dashboard grant
	exp: number; // epoch ms
}

function secret(): string {
	const configured = env.BETTER_AUTH_SECRET;
	if (configured) return configured;
	// In prod, a missing secret means cookies/OTP would be signed with a public
	// default — every signature forgeable. Fail loudly instead of doing that.
	if (!dev) throw new Error('BETTER_AUTH_SECRET is required in production');
	// Dev-only convenience: keep a misconfigured dev box from crashing.
	return 'veent-portal-dev-secret';
}

function sign(data: string): string {
	return createHmac('sha256', secret()).update(data).digest('base64url');
}

/** Build the signed cookie value for a pending verification. */
export function serializePending(input: {
	phone: string;
	intent: OtpIntent;
	name?: string;
	mac?: string;
}): string {
	const payload: PendingVerification = {
		phone: input.phone,
		intent: input.intent,
		name: input.name,
		mac: input.mac,
		exp: Date.now() + PENDING_MAX_AGE * 1000
	};
	const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
	return `${data}.${sign(data)}`;
}

/** Verify the signature + expiry of a cookie value and return its payload. */
export function parsePending(cookie: string | undefined): PendingVerification | null {
	if (!cookie) return null;
	const dot = cookie.lastIndexOf('.');
	if (dot < 0) return null;
	const data = cookie.slice(0, dot);
	const sig = cookie.slice(dot + 1);

	const expected = sign(data);
	const sigBuf = Buffer.from(sig);
	const expectedBuf = Buffer.from(expected);
	if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

	try {
		const payload = JSON.parse(
			Buffer.from(data, 'base64url').toString('utf8')
		) as PendingVerification;
		if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
		return payload;
	} catch {
		return null;
	}
}

/** +639171234567 -> "+63 ••• ••• 4567" */
export function maskPhone(phone: string): string {
	return `${phone.slice(0, 3)} ••• ••• ${phone.slice(-4)}`;
}

/**
 * Deliver the OTP via iTexMo (https://itexmo.com), the PH SMS gateway, Broadcast-OTP API.
 * THE SINGLE SMS INTEGRATION POINT — wired into the phoneNumber plugin's `sendOTP`.
 * The phone arrives E.164 (+639171234567); iTexMo wants the LOCAL form (09171234567),
 * so we convert.
 *
 * Config (customer env — first three required to send, from the iTexMo dashboard):
 *   ITEXMO_API_CODE
 *   ITEXMO_EMAIL
 *   ITEXMO_PASSWORD
 *   ITEXMO_SENDER_ID  (optional) — an approved sender id; on a TRIAL account this MUST
 *                      be "ITM.TEST3". Omit to use the account default.
 *
 * Not configured → dev prints the code to the server console (so you can still log
 * in); production treats missing config as a hard error (an OTP MUST be delivered —
 * never silently swallow it, that would let anyone "log in" with no code).
 */
export async function sendOtp(phone: string, code: string): Promise<void> {
	const apiCode = env.ITEXMO_API_CODE;
	const email = env.ITEXMO_EMAIL;
	const password = env.ITEXMO_PASSWORD;

	if (!apiCode || !email || !password) {
		if (dev) {
			console.info(`[otp] iTexMo not configured — code for ${phone}: ${code}`);
			return;
		}
		throw new Error('iTexMo not configured: set ITEXMO_API_CODE / ITEXMO_EMAIL / ITEXMO_PASSWORD');
	}

	// iTexMo expects the local PH format (09xxxxxxxxx), not E.164.
	const recipient = phone.replace(/^\+?63/, '0');

	const payload: Record<string, unknown> = {
		ApiCode: apiCode,
		Email: email,
		Password: password,
		Recipients: [recipient],
		Message: `Your Veent code is ${code}. It expires in 5 minutes.`
	};
	const senderId = env.ITEXMO_SENDER_ID;
	if (senderId) payload.SenderId = senderId;

	// Bound the call: `fetch` has no default timeout, so a slow/unreachable iTexMo would hang the
	// whole login request — and leave the guest stuck on the "Send code" spinner. AbortSignal.timeout
	// caps it; a timeout surfaces as a normal send failure the login action can turn into a retry.
	let res: Response;
	try {
		res = await fetch('https://api.itexmo.com/api/broadcast-otp', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(10_000)
		});
	} catch (err) {
		throw new Error(
			`iTexMo SMS send failed: ${err instanceof Error ? err.message : String(err)}`
		);
	}

	// Transport-level failure.
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new Error(`iTexMo SMS send failed (${res.status}): ${detail}`);
	}
	// API-level result: { Error, Accepted, Failed, ReferenceId, Message? }. Treat a
	// gateway error OR a recipient that wasn't accepted as a failure — a 200 with
	// Accepted: 0 means the code never went out.
	const body = (await res.json().catch(() => null)) as
		| { Error?: boolean; Accepted?: number; Message?: string }
		| null;
	if (!body || body.Error || (body.Accepted ?? 0) < 1) {
		throw new Error(`iTexMo SMS rejected: ${body?.Message ?? 'no recipient accepted'}`);
	}
}
