import { env } from '$env/dynamic/private';
import { createDb } from '@veent/db';

// This app reads its own DATABASE_URL and builds the shared client. All apps
// point at the SAME database; the schema lives in @veent/db.
export const db = createDb(env.DATABASE_URL);
