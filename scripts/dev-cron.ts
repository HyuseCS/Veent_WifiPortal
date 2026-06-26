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

const fileEnv = readEnvFile(join(root, 'apps/customer/.env'));

const SECRET = process.env.CRON_SECRET ?? fileEnv.CRON_SECRET ?? '';
// Use `localhost`, not `127.0.0.1`: Vite's dev server binds IPv6 loopback (`::1`) only, so an
// IPv4 literal is refused ("unreachable"). `localhost` resolves to whichever family is listening.
const BASE_URL = (process.env.DEV_CRON_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const INTERVAL_MS = Number(process.env.DEV_CRON_INTERVAL_MS ?? 60_000);

if (!SECRET) {
	console.error(
		'[dev-cron] CRON_SECRET not found (checked $CRON_SECRET and apps/customer/.env). ' +
			'The endpoints are fail-closed, so set it before running.'
	);
	process.exit(1);
}

const ENDPOINTS = ['/api/network/revoke', '/api/payments/reconcile'] as const;

async function hit(path: string): Promise<void> {
	const url = `${BASE_URL}${path}`;
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'x-cron-secret': SECRET }
		});
		const body = await res.text().catch(() => '');
		const stamp = new Date().toISOString().slice(11, 19);
		if (res.ok) {
			console.log(`[dev-cron ${stamp}] ${path} → ${res.status} ${body}`);
		} else {
			console.warn(`[dev-cron ${stamp}] ${path} → ${res.status} ${body}`);
		}
	} catch (e) {
		// Dev server not up yet / restarting — log and keep ticking.
		console.warn(`[dev-cron] ${path} unreachable: ${(e as Error).message}`);
	}
}

async function tick(): Promise<void> {
	await Promise.all(ENDPOINTS.map(hit));
}

console.log(
	`[dev-cron] hitting ${BASE_URL}{${ENDPOINTS.join(',')}} every ${INTERVAL_MS / 1000}s. Ctrl-C to stop.`
);
await tick();
setInterval(tick, INTERVAL_MS);
