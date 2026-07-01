/**
 * Throwaway iTexMo connectivity/verification probe.
 *
 *   bun run scripts/test-itexmo.ts 09171234567
 *
 * Reads ITEXMO_* from apps/customer/.env, sends a single test OTP to the given
 * recipient (local PH format 09xxxxxxxxx), and prints iTexMo's raw response so
 * you can see whether the account/sender id is verified vs. still on trial.
 *
 * NOTE: this actually sends an SMS and consumes a credit. On a TRIAL account the
 * sender id must be "ITM.TEST3" and the recipient must be a registered test number.
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
	console.error('Usage: bun run scripts/test-itexmo.ts <09xxxxxxxxx>');
	process.exit(1);
}

const env = loadEnv(fileURLToPath(new URL('../apps/customer/.env', import.meta.url)));
const { ITEXMO_API_CODE, ITEXMO_EMAIL, ITEXMO_PASSWORD, ITEXMO_SENDER_ID } = env;

if (!ITEXMO_API_CODE || !ITEXMO_EMAIL || !ITEXMO_PASSWORD) {
	console.error('Missing creds — uncomment ITEXMO_API_CODE / ITEXMO_EMAIL / ITEXMO_PASSWORD in apps/customer/.env');
	process.exit(1);
}

const payload: Record<string, unknown> = {
	ApiCode: ITEXMO_API_CODE,
	Email: ITEXMO_EMAIL,
	Password: ITEXMO_PASSWORD,
	Recipients: [recipient],
	Message: 'Veent iTexMo verification probe — please ignore.'
};
if (ITEXMO_SENDER_ID) payload.SenderId = ITEXMO_SENDER_ID;

console.log(`→ POST broadcast-otp  recipient=${recipient}  sender=${ITEXMO_SENDER_ID || '(account default)'}`);
const res = await fetch('https://api.itexmo.com/api/broadcast-otp', {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(payload)
});
console.log(`HTTP ${res.status} ${res.statusText}`);
const text = await res.text();
try {
	console.log('Response:', JSON.stringify(JSON.parse(text), null, 2));
} catch {
	console.log('Response (raw):', text);
}
