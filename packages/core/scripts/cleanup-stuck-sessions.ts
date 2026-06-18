/**
 * Lists active network sessions and expires any whose MAC isn't a real device MAC
 * (the `DEV:00:…` placeholder left over from stub-era / direct-navigation tests).
 * These never get swept by the revoke cron and they break the dashboard's keyed
 * list. Throwaway maintenance script.
 *
 *   bun --env-file=apps/admin/.env packages/core/scripts/cleanup-stuck-sessions.ts [--all]
 *     --all   expire EVERY active session (full reset), not just bogus-MAC ones
 */
import { createDb, networkSessions } from '@veent/db';
import { SESSION_STATUS } from '@veent/core';
import { and, eq } from 'drizzle-orm';

const MAC_RE = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;
const all = process.argv.includes('--all');

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('Missing DATABASE_URL');
	process.exit(1);
}
const db = createDb(url);

const active = await db
	.select({ id: networkSessions.id, mac: networkSessions.macAddress, startedAt: networkSessions.startedAt })
	.from(networkSessions)
	.where(eq(networkSessions.status, SESSION_STATUS.active));

console.log(`Active sessions: ${active.length}`);
for (const s of active) console.log(`  id=${s.id} mac=${s.mac ?? '(null)'} started=${s.startedAt?.toISOString?.() ?? s.startedAt}`);

const targets = all ? active : active.filter((s) => !s.mac || !MAC_RE.test(s.mac));
if (targets.length === 0) {
	console.log('\nNothing to clean.');
	process.exit(0);
}

console.log(`\nExpiring ${targets.length} session(s)${all ? ' (--all)' : ' with bogus/missing MAC'}…`);
for (const s of targets) {
	await db
		.update(networkSessions)
		.set({ status: SESSION_STATUS.expired })
		.where(and(eq(networkSessions.id, s.id), eq(networkSessions.status, SESSION_STATUS.active)));
	console.log(`  expired id=${s.id} (${s.mac ?? 'null'})`);
}
console.log('Done.');
