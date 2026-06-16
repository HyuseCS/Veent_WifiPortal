import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

// Single source of truth for migrations across BOTH apps. The shared Postgres
// holds every table (customer_*, admin_*, and each app's domain tables); only
// this package ever generates/runs migrations so the schema can never diverge.
export default defineConfig({
	schema: './src/schema/index.ts',
	out: './drizzle',
	dialect: 'postgresql',
	dbCredentials: { url: process.env.DATABASE_URL },
	verbose: true,
	strict: true
});
