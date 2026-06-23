/**
 * Register / inspect the Maya Checkout webhooks for this app.
 *
 *   bun run maya:webhooks list
 *   bun run maya:webhooks register https://abc123.ngrok-free.app
 *   bun run maya:webhooks clear
 *
 * (bun auto-loads apps/customer/.env, so MAYA_SECRET_KEY / MAYA_SANDBOX can live
 * there instead of the command line.)
 *
 * Maya secures Checkout webhooks by IP allowlist, not HMAC, so the running app
 * confirms each event by re-fetching the payment with the secret key
 * (see packages/core/.../payments/maya.ts). This script only tells Maya WHERE to
 * send those notifications.
 *
 * `register` is idempotent: Maya allows one callback URL per event name, so we
 * DELETE any existing registration for each event before re-creating it. That
 * makes it safe to re-run every time your tunnel URL changes.
 */

// The events we care about. PAYMENT_SUCCESS is the one that credits; the others
// let the /top-up/processing page stop waiting instead of timing out.
const EVENTS = ['PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'PAYMENT_EXPIRED'] as const;

// This app's webhook route. Appended automatically when you pass a bare origin.
const WEBHOOK_PATH = '/api/webhooks/payment';

const PROD_BASE = 'https://pg.paymaya.com';
const SANDBOX_BASE = 'https://pg-sandbox.paymaya.com';

type Webhook = { id: string; name: string; callbackUrl: string };

const secretKey = process.env.MAYA_SECRET_KEY;
if (!secretKey) {
	console.error('Missing MAYA_SECRET_KEY. Set it in apps/customer/.env or the command line.');
	process.exit(1);
}
// Mirror the app's host selection (apps/customer/src/lib/server/payments.ts).
const sandbox = process.env.MAYA_SANDBOX !== 'false';
const base = sandbox ? SANDBOX_BASE : PROD_BASE;

/** Basic auth with the secret key as username + blank password (Maya's scheme). */
const authHeader = `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;

async function api(path: string, init?: RequestInit) {
	const res = await fetch(`${base}/checkout/v1/webhooks${path}`, {
		...init,
		headers: { authorization: authHeader, 'content-type': 'application/json', ...init?.headers }
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new Error(`Maya API ${res.status} ${res.statusText}: ${detail}`);
	}
	// DELETE returns an empty body; guard the JSON parse.
	const text = await res.text();
	return text ? JSON.parse(text) : null;
}

async function listWebhooks(): Promise<Webhook[]> {
	const data = await api('');
	return Array.isArray(data) ? data : (data?.webhooks ?? []);
}

/** Turn a bare origin (or full URL) into the exact callback URL Maya should call. */
function toCallbackUrl(input: string): string {
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		console.error(`Not a valid URL: ${input}`);
		process.exit(1);
	}
	if (url.protocol !== 'https:') {
		console.error('Maya only delivers webhooks to https:// URLs (use an ngrok/tunnel URL).');
		process.exit(1);
	}
	if (url.pathname === '/' || url.pathname === '') url.pathname = WEBHOOK_PATH;
	return url.toString();
}

async function cmdList() {
	const hooks = await listWebhooks();
	if (!hooks.length) {
		console.log(`(no webhooks registered on ${sandbox ? 'sandbox' : 'production'})`);
		return;
	}
	console.log(`Registered webhooks (${sandbox ? 'sandbox' : 'production'}):`);
	for (const h of hooks) console.log(`  ${h.name.padEnd(18)} → ${h.callbackUrl}  [${h.id}]`);
}

async function cmdRegister(rawUrl: string) {
	const callbackUrl = toCallbackUrl(rawUrl);
	const existing = await listWebhooks();

	for (const name of EVENTS) {
		// Delete any prior registration for this event so the POST can't 409.
		for (const stale of existing.filter((h) => h.name === name)) {
			await api(`/${stale.id}`, { method: 'DELETE' });
		}
		const created = await api('', { method: 'POST', body: JSON.stringify({ name, callbackUrl }) });
		console.log(`✓ ${name.padEnd(18)} → ${callbackUrl}  [${created?.id ?? '?'}]`);
	}
	console.log(`\nDone. Maya (${sandbox ? 'sandbox' : 'production'}) will notify ${callbackUrl}`);
}

async function cmdClear() {
	const hooks = await listWebhooks();
	const ours = hooks.filter((h) => (EVENTS as readonly string[]).includes(h.name));
	for (const h of ours) {
		await api(`/${h.id}`, { method: 'DELETE' });
		console.log(`✗ removed ${h.name} [${h.id}]`);
	}
	if (!ours.length) console.log('(nothing to remove)');
}

const [cmd, arg] = process.argv.slice(2);

async function main() {
	switch (cmd) {
		case 'list':
			return cmdList();
		case 'register':
			if (!arg) {
				console.error('Usage: bun run maya:webhooks register <https-url>');
				process.exit(1);
			}
			return cmdRegister(arg);
		case 'clear':
			return cmdClear();
		default:
			console.error('Usage: bun run maya:webhooks <list | register <url> | clear>');
			process.exit(1);
	}
}

main().catch((err) => {
	console.error('Failed:', err instanceof Error ? err.message : err);
	process.exit(1);
});
