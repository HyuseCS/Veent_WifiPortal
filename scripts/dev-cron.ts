#!/usr/bin/env bun
/**
 * Local dev scheduler — the thing prod runs as a systemd timer / crontab (see
 * docs/DEPLOYMENT.md §8). On a dev box nothing hits the cron endpoints, so paid/free
 * time never expires on the router and missed-webhook payments never self-heal. Run this
 * in a second terminal alongside `bun run dev:customer`:
 *
 *     bun run dev:cron
 *
 * It POSTs the two customer cron endpoints once a minute with the `x-cron-secret` header,
 * exactly as a real scheduler would. Reads CRON_SECRET + the base URL from apps/customer/.env
 * (override with env vars CRON_SECRET / DEV_CRON_BASE_URL / DEV_CRON_INTERVAL_MS).
 *
 * This is dev convenience only — it changes nothing about the app; prod still uses an
 * external scheduler. Stop it with Ctrl-C.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env reader (KEY=VALUE, strips surrounding quotes, ignores comments). */
function readEnvFile(path: string): Record<string, string> {
	const out: Record<string, string> = {};
	let raw: string;
	try {
		raw = readFileSync(path, 'utf8');
	} catch {
		return out;
	}
	for (const line of raw.split('\n')) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
		if (!m) continue;
		out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
	}
	return out;
}

const custEnv = readEnvFile(join(root, 'apps/customer/.env'));
const adminEnv = readEnvFile(join(root, 'apps/admin/.env'));

// Customer and admin have SEPARATE CRON_SECRETs, so each target carries its own.
const CUST_SECRET = process.env.CRON_SECRET ?? custEnv.CRON_SECRET ?? '';
const ADMIN_SECRET = process.env.ADMIN_CRON_SECRET ?? adminEnv.CRON_SECRET ?? '';
// Use `localhost`, not `127.0.0.1`: Vite's dev server binds IPv6 loopback (`::1`) only, so an
// IPv4 literal is refused ("unreachable"). `localhost` resolves to whichever family is listening.
const CUST_URL = (process.env.DEV_CRON_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const ADMIN_URL = (process.env.DEV_CRON_ADMIN_BASE_URL ?? 'http://localhost:5174').replace(/\/$/, '');
const INTERVAL_MS = Number(process.env.DEV_CRON_INTERVAL_MS ?? 60_000);

if (!CUST_SECRET) {
	console.error(
		'[dev-cron] CRON_SECRET not found (checked $CRON_SECRET and apps/customer/.env). ' +
			'The endpoints are fail-closed, so set it before running.'
	);
	process.exit(1);
}

// Each target = a cron endpoint + the secret for ITS app. Customer: revoke (drives expiry AND the
// outage auto-pause) + payments reconcile. Admin: health refresh, which writes `network_health` —
// the table the outage auto-pause reads, so without it no down APs are ever detected.
type Target = { url: string; secret: string; label: string };
const TARGETS: Target[] = [
	{ url: `${CUST_URL}/api/network/revoke`, secret: CUST_SECRET, label: 'revoke' },
	{ url: `${CUST_URL}/api/payments/reconcile`, secret: CUST_SECRET, label: 'reconcile' }
];
if (ADMIN_SECRET) {
	TARGETS.push({ url: `${ADMIN_URL}/api/network/health/refresh`, secret: ADMIN_SECRET, label: 'health' });
} else {
	console.warn(
		'[dev-cron] admin CRON_SECRET not found (apps/admin/.env) — skipping health refresh; ' +
			'the outage auto-pause needs it to detect down APs.'
	);
}

async function hit(t: Target): Promise<void> {
	try {
		const res = await fetch(t.url, {
			method: 'POST',
			headers: { 'x-cron-secret': t.secret }
		});
		const body = await res.text().catch(() => '');
		const stamp = new Date().toISOString().slice(11, 19);
		if (res.ok) {
			console.log(`[dev-cron ${stamp}] ${t.label} → ${res.status} ${body}`);
		} else {
			console.warn(`[dev-cron ${stamp}] ${t.label} → ${res.status} ${body}`);
		}
	} catch (e) {
		// Dev server not up yet / restarting — log and keep ticking.
		console.warn(`[dev-cron] ${t.label} unreachable: ${(e as Error).message}`);
	}
}

async function tick(): Promise<void> {
	await Promise.all(TARGETS.map(hit));
}

console.log(
	`[dev-cron] hitting [${TARGETS.map((t) => t.label).join(', ')}] every ${INTERVAL_MS / 1000}s. Ctrl-C to stop.`
);
await tick();
setInterval(tick, INTERVAL_MS);
