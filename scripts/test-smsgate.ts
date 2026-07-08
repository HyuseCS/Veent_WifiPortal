/**
 * Throwaway SMS Gate (sms-gate.app, Cloud mode) connectivity/verification probe.
 *
 *   bun run scripts/test-smsgate.ts +639171234567
 *
 * Reads SMSGATE_* from apps/customer/.env, POSTs a single test message to the given recipient
 * (E.164, +63…) via the cloud 3rd-party API, and prints the raw response so you can confirm the
 * Basic-auth creds and response shape before/while relying on the otp.ts send path.
 *
 * SMSGATE_BASE_URL is optional (defaults to https://api.sms-gate.app); SMSGATE_USERNAME /
 * SMSGATE_PASSWORD come from enabling Cloud Server in the SMS Gate app.
 *
 * NOTE: this actually sends an SMS from the registered Android phone.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function loadEnv(path: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of readFileSync(path, 'utf8').split('\n')) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
		if (!m) continue; // skips blanks and #comments
		out[m[1]] = m[2].replace(/^["']|["']$/g, '');
	}
	return out;
}

const recipient = process.argv[2];
if (!recipient) {
	console.error('Usage: bun run scripts/test-smsgate.ts "+639xxxxxxxxx"');
	process.exit(1);
}

const env = loadEnv(fileURLToPath(new URL('../apps/customer/.env', import.meta.url)));
const { SMSGATE_USERNAME, SMSGATE_PASSWORD } = env;
const SMSGATE_BASE_URL = env.SMSGATE_BASE_URL?.trim() || 'https://api.sms-gate.app';

if (!SMSGATE_USERNAME || !SMSGATE_PASSWORD) {
	console.error('Missing config — set SMSGATE_USERNAME / SMSGATE_PASSWORD in apps/customer/.env');
	process.exit(1);
}

const authorization = 'Basic ' + btoa(`${SMSGATE_USERNAME}:${SMSGATE_PASSWORD}`);
const url = `${SMSGATE_BASE_URL.replace(/\/+$/, '')}/3rdparty/v1/messages`;

console.log(`→ POST ${url}  recipient=${recipient}`);
const res = await fetch(url, {
	method: 'POST',	
	headers: { 'Content-Type': 'application/json', 'Authorization': authorization },
	body: JSON.stringify({
		textMessage: { text: 'Veent SMS Gate verification probe — please ignore.' },
		phoneNumbers: [recipient]
	})
});
console.log(`HTTP ${res.status} ${res.statusText}`);
const text = await res.text();
try {
	console.log('Response:', JSON.stringify(JSON.parse(text), null, 2));
} catch {
	console.log('Response (raw):', text);
}
