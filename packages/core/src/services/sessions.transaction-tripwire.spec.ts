import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Static source-text tripwire (AC6 defense-in-depth) — NOT a runtime test. It proves the durable
 * AP-circuit resolution happens BEFORE each grant function's `db.transaction(` opens, so a
 * slow/failed AP lookup can never stall or roll back a money-moving/access-granting transaction.
 *
 * Design note (per the plan's Risk Notes): unlike networkHealth's tripwire, `sessions.ts` legitimately
 * contains MANY unrelated `db.transaction(` calls, so a whole-file "no db.transaction(" check is
 * inapplicable. Instead, for each grant function this extracts its source slice and asserts the line
 * index of the pre-tx resolution call (`resolveApCircuitPreTx(`) is STRICTLY LESS than the line index
 * of that function's own `db.transaction(` — sufficient to prove pre-tx placement without brace
 * parsing. Positive anchors (both tokens must be present) keep the assertion non-vacuous.
 *
 * The runtime proof that the resolution FAILURE is harmless lives in sessions.spec.ts (AC6).
 */

const sessionsPath = resolve(dirname(fileURLToPath(import.meta.url)), 'sessions.ts');
const source = readFileSync(sessionsPath, 'utf8');
const lines = source.split('\n');

/** Source slice from `export async function <name>(` to the next `export async function` (or EOF). */
function functionSlice(name: string): string[] {
	const start = lines.findIndex((l) => l.includes(`export async function ${name}(`));
	if (start === -1) throw new Error(`tripwire: ${name} not found in sessions.ts`);
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (lines[i].includes('export async function ')) {
			end = i;
			break;
		}
	}
	return lines.slice(start, end);
}

describe('grant-function pre-transaction AP-resolution tripwire (AC6 defense-in-depth)', () => {
	for (const fn of ['startPaidAccessAndBindDevice', 'startFreeAccessAndBindDevice']) {
		it(`${fn}: resolveApCircuitPreTx( appears before its db.transaction(`, () => {
			const slice = functionSlice(fn);
			const resolveIdx = slice.findIndex((l) => l.includes('resolveApCircuitPreTx('));
			const txIdx = slice.findIndex((l) => l.includes('db.transaction('));

			// Positive anchors: both tokens exist in the function body (non-vacuous).
			expect(resolveIdx).toBeGreaterThanOrEqual(0);
			expect(txIdx).toBeGreaterThanOrEqual(0);

			// The guard: resolution is textually BEFORE the transaction opens.
			expect(resolveIdx).toBeLessThan(txIdx);
		});
	}
});
