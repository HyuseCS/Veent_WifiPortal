/**
 * Clears ALL test data, leaving an empty (but fully-migrated) schema. Truncates the
 * data tables and cascades to every dependent (auth rows, profiles, ledger, sessions,
 * payments). Keeps the schema and the migration-seeded `admin_role` lookup.
 *
 *   bun run --filter radius-admin test:clear      # from the repo root
 *
 * After this the DB is empty: no staff logins, customers, APs, or packages. Run
 * `bun run --filter radius-admin test:seed` to repopulate before using the app again.
 *
 * ponytail: one TRUNCATE ... CASCADE does the whole job — every other table has an FK
 * to one of these four, so CASCADE empties them too. No per-table delete needed.
 */
import postgres from 'postgres';

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) throw new Error('DATABASE_URL is not set (apps/admin/.env)');

const sql = postgres(DATABASE_URL, { max: 1 });

try {
	await sql.unsafe(
		'TRUNCATE customer_user, admin_user, network_health, packages RESTART IDENTITY CASCADE;'
	);
	console.log('✓ Test data cleared — schema is empty. Run `test:seed` to repopulate.');
} catch (err) {
	console.error('✗ Clear failed:', err);
	process.exit(1);
} finally {
	await sql.end();
}
process.exit(0);
