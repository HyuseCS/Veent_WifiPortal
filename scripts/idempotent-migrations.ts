#!/usr/bin/env bun
/**
 * One-off: rewrite committed Drizzle migrations to be idempotent so `db:migrate`
 * never dies on "already exists" on a teammate's machine (db:push'd schema, restored
 * dump, partial apply). Safe to re-run. Drizzle gates by journal timestamp, so editing
 * historical SQL never re-runs it where already applied.
 *
 * Handles the mechanical statements. CREATE TRIGGER (0006) is fixed by hand.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages/db/drizzle');
let changed = 0;

for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
	const path = join(dir, file);
	const before = readFileSync(path, 'utf8');
	const out = before
		.split('\n')
		.map((line) => {
			if (line.startsWith('DO $$')) return line; // already guarded
			if (line.startsWith('CREATE TABLE "')) return line.replace('CREATE TABLE "', 'CREATE TABLE IF NOT EXISTS "');
			if (line.startsWith('CREATE UNIQUE INDEX "'))
				return line.replace('CREATE UNIQUE INDEX "', 'CREATE UNIQUE INDEX IF NOT EXISTS "');
			if (line.startsWith('CREATE INDEX "')) return line.replace('CREATE INDEX "', 'CREATE INDEX IF NOT EXISTS "');
			if (line.includes('ADD COLUMN "') && !line.includes('ADD COLUMN IF NOT EXISTS'))
				return line.replace('ADD COLUMN "', 'ADD COLUMN IF NOT EXISTS "');
			// Wrap a single-line ADD CONSTRAINT so a duplicate is ignored.
			const m = line.match(/^(ALTER TABLE .*ADD CONSTRAINT .*?;)(\s*--> statement-breakpoint)?\s*$/);
			if (m) return `DO $$ BEGIN ${m[1]} EXCEPTION WHEN duplicate_object THEN null; END $$;${m[2] ?? ''}`;
			return line;
		})
		.join('\n');
	if (out !== before) {
		writeFileSync(path, out);
		changed++;
		console.log(`  rewrote ${file}`);
	}
}
console.log(`\n${changed} migration(s) made idempotent.`);
