import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { captureHandled } from '@veent/core';
import { customerOtpDeliveryLog } from '@veent/db/schema';
import { db } from '$lib/server/db';

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

/** The OTP text — identical across providers and under the 160-char SMS limit. */
function otpMessage(code: string): string {
	return `Your Parafiber code is ${code}. It expires in 5 minutes.`;
}

/**
 * THE single SMS delivery seam (wired into the phoneNumber plugin's `sendOTP`). Dispatches to the
 * configured gateway so we can switch providers without touching the auth flow — set `SMS_PROVIDER`
 * to `cast` (default), `itexmo`, `unisms`, or `smsgate`. The phone arrives E.164 (+639171234567);
 * each provider adapts it (iTexMo wants the local 09… form; Cast, UniSMS and SMS Gate take E.164
 * as-is).
 *
 * `smsgate` is a TEMPORARY stopgap (an Android phone running SMS Gate in Cloud mode, reached via
 * api.sms-gate.app) used while iTexMo account approval is pending — remove it once iTexMo is live.
 *
 * Fail-safe BY ENVIRONMENT (per provider): missing config in DEV prints the code to the server
 * console so you can still log in; in PRODUCTION it's a hard error — an OTP MUST be delivered, never
 * silently swallowed (that would let anyone "log in" with no code).
 */
export async function sendOtp(phone: string, code: string): Promise<void> {
	const provider = (env.SMS_PROVIDER ?? 'cast').trim().toLowerCase();
	// Explicit `cast` branch + a throw for anything unrecognized. The previous fall-through
	// silently routed a typo'd SMS_PROVIDER to Cast, so a misconfigured box looked healthy while
	// sending through the wrong gateway. Unset/blank STILL defaults to Cast (standing decision):
	// `?? 'cast'` covers unset, and the `=== ''` guard covers an explicitly blank/whitespace value.
	if (provider === '' || provider === 'cast') return sendViaCast(phone, code);
	if (provider === 'smsgate') return sendViaSMSGate(phone, code);
	if (provider === 'unisms') return sendViaUniSMS(phone, code);
	if (provider === 'itexmo') return sendViaITexMo(phone, code);
	throw new Error(`Unrecognized SMS_PROVIDER: "${provider}"`);
}

/**
 * Append one row to the OTP delivery log after a gateway ACCEPTS a message. Fire-and-forget at
 * the call site (`void logDeliveryAttempt(...)`) so a slow insert never adds latency to the
 * guest's login request.
 *
 * NEVER THROWS, and never rejects. This is the guest-authentication path: a logging failure must
 * degrade to a Sentry warning, never to a failed login. The insert is deliberately `await`-ed
 * INSIDE the try — a Drizzle query builder is a thenable, so an un-awaited insert's rejection
 * would escape this try/catch entirely and become an unhandled promise rejection on the login
 * path. Do not "simplify" the await away.
 *
 * PII: stores `maskPhone()` output only, never the raw E.164 number.
 */
async function logDeliveryAttempt(
	provider: string,
	providerMessageId: string | null,
	phone: string
): Promise<void> {
	try {
		await db.insert(customerOtpDeliveryLog).values({
			provider,
			providerMessageId,
			phoneMasked: maskPhone(phone)
		});
	} catch (err) {
		captureHandled(err, { level: 'warning', tags: { area: 'otp-send-log' } });
	}
}

/**
 * Cast (https://api.cast.ph) OTP API — the dedicated, higher-priority OTP pool (NOT /sms/send).
 * Config (customer env):
 *   CAST_API_KEY   — REQUIRED. Sent as the x-api-key header. Live keys start cast_, sandbox cast_test_.
 *   CAST_SENDER_ID — optional; only needed if the account has more than one approved sender id.
 */
async function sendViaCast(phone: string, code: string): Promise<void> {
	const apiKey = env.CAST_API_KEY;

	if (!apiKey) {
		if (dev) {
			console.info(`[otp] Cast not configured — code for ${phone}: ${code}`);
			return;
		}
		throw new Error('Cast not configured: set CAST_API_KEY');
	}

	// `phone` is already E.164 (+63…) and Cast takes it as-is — no reformatting.
	const payload: Record<string, unknown> = { to: phone, message: otpMessage(code) };
	const senderId = env.CAST_SENDER_ID;
	if (senderId) payload.sender_id = senderId;

	let res: Response;
	try {
		res = await fetch('https://api.cast.ph/api/v1/otp/send', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(10_000)
		});
	} catch (err) {
		throw new Error(`Cast SMS send failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
	}

	// A non-2xx OR a body without `success: true` means the code never went out. Surface the stable
	// machine-readable error_code when the gateway supplies one.
	const body = (await res.json().catch(() => null)) as
		| { success?: boolean; error?: string; error_code?: string; message_id?: string }
		| null;
	if (!res.ok || !body?.success) {
		throw new Error(
			`Cast SMS rejected (${res.status})${body?.error_code ? ` [${body.error_code}]` : ''}: ${body?.error ?? 'no success flag'}`
		);
	}

	// Gateway accepted — record the attempt so the sweep cron can later ask Cast whether the
	// CARRIER actually delivered it. Fire-and-forget; logDeliveryAttempt never throws.
	void logDeliveryAttempt('cast', body.message_id ?? null, phone);

	// Dev-only proof-of-send: sandbox sends deliver no real SMS, so echo Cast's response plus the
	// message body to the console. Guarded by `dev` — the message contains the OTP code and must
	// never reach a production log.
	if (dev) {
		console.info(`[otp] Cast accepted: ${JSON.stringify(body)}`);
		console.info(`[otp] Cast message to ${phone}: ${otpMessage(code)}`);
	}
}

/**
 * iTexMo (https://itexmo.com) Broadcast-OTP API. Config (customer env — first three required):
 *   ITEXMO_API_CODE / ITEXMO_EMAIL / ITEXMO_PASSWORD
 *   ITEXMO_SENDER_ID (optional) — approved sender id; on a TRIAL account this MUST be "ITM.TEST3".
 */
async function sendViaITexMo(phone: string, code: string): Promise<void> {
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
		Message: otpMessage(code)
	};
	const senderId = env.ITEXMO_SENDER_ID;
	if (senderId) payload.SenderId = senderId;

	// Bound the call: `fetch` has no default timeout, so a slow/unreachable gateway would hang the
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
		throw new Error(`iTexMo SMS send failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
	}

	// Transport-level failure.
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new Error(`iTexMo SMS send failed (${res.status}): ${detail}`);
	}
	// API-level result: { Error, Accepted, Failed, ReferenceId, Message? }. Treat a gateway error OR
	// a recipient that wasn't accepted as a failure — a 200 with Accepted: 0 means nothing went out.
	const body = (await res.json().catch(() => null)) as
		| { Error?: boolean; Accepted?: number; Message?: string }
		| null;
	if (!body || body.Error || (body.Accepted ?? 0) < 1) {
		throw new Error(`iTexMo SMS rejected: ${body?.Message ?? 'no recipient accepted'}`);
	}

	// Row written for every provider (satisfies the `provider` discriminator), but only Cast is
	// ever swept — it's the only gateway with a DLR status endpoint. No message id to record here.
	void logDeliveryAttempt('itexmo', null, phone);
}

/**
 * UniSMS (https://unismsapi.com) Send-SMS API. Basic auth = the secret key as the username with an
 * empty password; recipient in E.164 (which normalizePhone already produces). Config (customer env,
 * BOTH required to send):
 *   UNISMS_SECRET_KEY — the API secret key (sk_…)
 *   UNISMS_SENDER_ID  — an approved/trial sender id (UniSMS requires one on EVERY message)
 */
async function sendViaUniSMS(phone: string, code: string): Promise<void> {
	const secretKey = env.UNISMS_SECRET_KEY;
	const senderId = env.UNISMS_SENDER_ID;

	if (!secretKey || !senderId) {
		if (dev) {
			console.info(`[otp] UniSMS not configured — code for ${phone}: ${code}`);
			return;
		}
		throw new Error('UniSMS not configured: set UNISMS_SECRET_KEY / UNISMS_SENDER_ID');
	}

	// Basic auth: base64("<secret-key>:") (empty password). `phone` is already E.164 (+63…).
	const authorization = 'Basic ' + Buffer.from(`${secretKey}:`).toString('base64');

	let res: Response;
	try {
		res = await fetch('https://unismsapi.com/api/sms', {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization },
			body: JSON.stringify({ recipient: phone, content: otpMessage(code), sender_id: senderId }),
			signal: AbortSignal.timeout(10_000)
		});
	} catch (err) {
		throw new Error(`UniSMS SMS send failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err});
	}

	// 201 Created on success (body echoes the queued message). A non-2xx OR a message that came back
	// `failed` means the code never went out.
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new Error(`UniSMS SMS send failed (${res.status}): ${detail}`);
	}
	const body = (await res.json().catch(() => null)) as
		| { message?: { status?: string; fail_reason?: string | null } }
		| null;
	if (!body?.message || body.message.status === 'failed') {
		throw new Error(`UniSMS SMS rejected: ${body?.message?.fail_reason ?? 'no message returned'}`);
	}

	void logDeliveryAttempt('unisms', null, phone);
}

/**
 * SMS Gate (https://sms-gate.app) — a TEMPORARY stopgap used while iTexMo approval is pending. Runs in
 * CLOUD mode: an Android phone (with SMS Gate's Cloud Server enabled) and the portal server both talk
 * OUTBOUND to api.sms-gate.app, so it works even when the site's AP isolates Wi-Fi clients / we don't
 * control the router. We POST the OTP to the cloud 3rd-party API and the phone picks it up and sends it.
 *
 * Endpoint: POST {SMSGATE_BASE_URL}/3rdparty/v1/messages  (over HTTPS). Basic auth = the username/
 * password from the app's Cloud Server registration; recipient in E.164 (which normalizePhone already
 * produces). Config (customer env):
 *   SMSGATE_BASE_URL — optional; defaults to https://api.sms-gate.app (override for a private server)
 *   SMSGATE_USERNAME / SMSGATE_PASSWORD — REQUIRED (from the app's Cloud Server credentials)
 *
 * Delete this branch once iTexMo is live.
 */
const SMSGATE_CLOUD_BASE = 'https://api.sms-gate.app';

async function sendViaSMSGate(phone: string, code: string): Promise<void> {
	const baseUrl = env.SMSGATE_BASE_URL?.trim() || SMSGATE_CLOUD_BASE;
	const username = env.SMSGATE_USERNAME;
	const password = env.SMSGATE_PASSWORD;

	if (!username || !password) {
		if (dev) {
			console.info(`[otp] SMS Gate not configured — code for ${phone}: ${code}`);
			return;
		}
		throw new Error('SMS Gate not configured: set SMSGATE_USERNAME / SMSGATE_PASSWORD');
	}

	// Basic auth: base64("<username>:<password>"). `phone` is already E.164 (+63…).
	const authorization = 'Basic ' + btoa(`${username}:${password}`);
	const url = `${baseUrl.replace(/\/+$/, '')}/3rdparty/v1/messages`;

	let res: Response;
	try {
		res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization },
			body: JSON.stringify({ textMessage: { text: otpMessage(code) }, phoneNumbers: [phone] }),
			signal: AbortSignal.timeout(10_000)
		});
	} catch (err) {
		throw new Error(`SMS Gate send failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
	}

	// 202 Accepted on success (the message is queued for the phone). A non-2xx OR a message that came
	// back in the `Failed` state means the code never went out.
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new Error(`SMS Gate send failed (${res.status}): ${detail}`);
	}
	const body = (await res.json().catch(() => null)) as { id?: string; state?: string } | null;
	if (!body?.id || body.state === 'Failed') {
		throw new Error(`SMS Gate rejected: ${body?.state ?? 'no message id returned'}`);
	}

	void logDeliveryAttempt('smsgate', null, phone);
}
