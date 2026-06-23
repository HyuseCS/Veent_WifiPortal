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
 * Deliver the code. THE SINGLE SMS INTEGRATION POINT — wired into the
 * phoneNumber plugin's `sendOTP`. The phone is already E.164. Example:
 *
 *   const res = await fetch('https://api.semaphore.co/api/v4/messages', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *       apikey: env.SEMAPHORE_API_KEY,
 *       number: phone,
 *       message: `Your Veent code is ${code}. It expires in 5 minutes.`
 *     })
 *   });
 *   if (!res.ok) throw new Error(`SMS send failed: ${res.status}`);
 */
export async function sendOtp(phone: string, code: string): Promise<void> {
	if (dev) {
		// No gateway in dev — read the code from the server console.
		console.info(`[otp] verification code for ${phone}: ${code}`);
		return;
	}
	// TODO(SMS): integrate the provider here before production.
	console.warn(`[otp] sendOtp not configured — code for ${phone} was not delivered`);
}
