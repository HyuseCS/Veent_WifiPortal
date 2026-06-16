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
export function createDb(connectionString: string) {
	if (!connectionString) throw new Error('createDb: connectionString is required');
	const client = postgres(connectionString);
	return drizzle(client, { schema });
}

export type DB = ReturnType<typeof createDb>;
