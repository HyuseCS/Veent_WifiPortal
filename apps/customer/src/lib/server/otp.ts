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
 * Deliver the OTP via Semaphore (https://semaphore.co), the PH SMS gateway.
 * THE SINGLE SMS INTEGRATION POINT — wired into the phoneNumber plugin's `sendOTP`.
 * The phone is already E.164 (e.g. +639171234567); Semaphore accepts that.
 *
 * Config (customer env):
 *   SEMAPHORE_API_KEY      (required to send) — from the Semaphore dashboard
 *   SEMAPHORE_SENDER_NAME  (optional) — an APPROVED sender name; omit to use the
 *                           account default ("SEMAPHORE" until you register one)
 *
 * Not configured → dev prints the code to the server console (so you can still log
 * in); production treats a missing key as a hard error (an OTP MUST be delivered —
 * never silently swallow it, that would let anyone "log in" with no code).
 */
export async function sendOtp(phone: string, code: string): Promise<void> {
	const apikey = env.SEMAPHORE_API_KEY;

	if (!apikey) {
		if (dev) {
			console.info(`[otp] Semaphore not configured — code for ${phone}: ${code}`);
			return;
		}
		throw new Error('Semaphore not configured: set SEMAPHORE_API_KEY');
	}

	// Semaphore's send endpoint takes form-encoded params. We send our own code
	// (better-auth generates it) via /messages, NOT the auto-code /otp endpoint.
	const params = new URLSearchParams({
		apikey,
		number: phone,
		message: `Your Veent code is ${code}. It expires in 5 minutes.`
	});
	const sender = env.SEMAPHORE_SENDER_NAME;
	if (sender) params.set('sendername', sender);

	const res = await fetch('https://api.semaphore.co/api/v4/messages', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: params
	});
	if (!res.ok) {
		// Semaphore returns JSON (an array on success, an error object on failure).
		const detail = await res.text().catch(() => '');
		throw new Error(`Semaphore SMS send failed (${res.status}): ${detail}`);
	}
}
