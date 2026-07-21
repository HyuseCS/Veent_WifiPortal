import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Static source-text tripwire — NOT a runtime test. It reads the two admin call sites of
 * `refreshNetworkHealth` and asserts neither is wrapped in a `db.transaction(...)`.
 *
 * Why this exists: `ap-name-collision-retry_PLAN_20-07-26.md` implemented the once-retry on
 * `network_health_name_key` collisions as a STANDALONE statement + try/catch (constraint E3's
 * cheaper branch), valid ONLY because `refreshNetworkHealth` is never called inside a wrapping
 * `db.transaction`. If a future edit wraps either call site in a transaction, a Postgres tx aborts
 * on the first error and every subsequent statement fails with "current transaction is aborted",
 * silently breaking the retry. This spec is the automated guard the backlog note asked for.
 *
 * See: process/general-plans/backlog/ap-name-retry-transaction-tripwire_NOTE_20-07-26.md (option 2),
 * and constraint E3 in per-ap-visibility_16-07-26/per-ap-visibility_PLAN_16-07-26.md.
 *
 * The assertion is non-vacuous: each file must contain `refreshNetworkHealth(` (positive anchor
 * proving the intended call site was actually read) AND must NOT contain `db.transaction(`. Paths
 * resolve from this file up to the repo root; a missing/renamed file makes `readFileSync` throw
 * loudly rather than silently passing.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../');

const callSites = [
	'apps/admin/src/routes/(app)/networks/+page.server.ts',
	'apps/admin/src/routes/api/network/health/refresh/+server.ts'
];

describe('refreshNetworkHealth transaction-wrapping tripwire (E3)', () => {
	for (const relPath of callSites) {
		it(`${relPath}: calls refreshNetworkHealth( and does NOT wrap it in db.transaction(`, () => {
			const source = readFileSync(resolve(repoRoot, relPath), 'utf8');

			// Positive anchor: proves we read the intended call site (non-vacuous).
			expect(source).toContain('refreshNetworkHealth(');

			// The guard: no transaction wrapper at this call site.
			expect(source).not.toContain('db.transaction(');
		});
	}
});
