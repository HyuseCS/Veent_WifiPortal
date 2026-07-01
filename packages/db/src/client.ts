import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Framework-agnostic Drizzle client factory.
 *
 * This package must NOT read environment variables itself (no `$env`, no direct
 * `process.env`) so it stays usable from any consumer — each SvelteKit app reads
 * its own `DATABASE_URL` and passes it in. All apps point at the SAME database.
 */
/** Max connections per app instance's query pool. Explicit (postgres.js defaults to 10) so a
 * connection leak can't grow unbounded and exhaust Postgres; the dashboard-feed LISTEN client
 * is separate (its own `max: 1`). Callers may override via `opts.max` (this package never reads
 * env itself — the app passes a value from its own config if it needs a different ceiling). */
const DEFAULT_POOL_MAX = 10;

export function createDb(connectionString: string, opts?: { max?: number }) {
	if (!connectionString) throw new Error('createDb: connectionString is required');
	const client = postgres(connectionString, { max: opts?.max ?? DEFAULT_POOL_MAX });
	return drizzle(client, { schema });
}

export type DB = ReturnType<typeof createDb>;

/**
 * A dedicated single connection for Postgres LISTEN/NOTIFY, kept SEPARATE from the
 * Drizzle query pool (a LISTEN ties up its connection for the process lifetime, so it
 * must not borrow from the pool). `postgres.js` owns it and re-issues any LISTEN on
 * reconnect. Use `.listen(channel, onNotify)`; the caller owns the lifecycle.
 */
export function createListenClient(connectionString: string): postgres.Sql {
	if (!connectionString) throw new Error('createListenClient: connectionString is required');
	return postgres(connectionString, { max: 1 });
}
