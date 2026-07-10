/**
 * Form-field parsing helpers. Kept pure (no DB/env) so they're unit-testable.
 */

/**
 * Parse a REQUIRED integer form field and bound it to `[min, max]`. Returns the
 * integer, or `null` when the field is missing/blank, non-integer, or out of range —
 * the caller turns `null` into its own 400. Used by the operational-limits save path
 * (device cap, free-time minutes/cooldown), so the bounds are load-bearing.
 *
 * NB: this is deliberately the "required integer in range" contract. The packages and
 * FAQ pages parse numbers with DIFFERENT contracts (optional/float-allowed, and
 * optional-with-default-0 respectively), so they keep their own local parsers rather
 * than bend this one out of shape.
 */
export function parseIntField(
	form: FormData,
	key: string,
	{ min, max }: { min: number; max: number }
): number | null {
	const raw = String(form.get(key) ?? '').trim();
	const n = Number(raw);
	if (raw === '' || !Number.isInteger(n) || n < min || n > max) return null;
	return n;
}

/** UTC-midnight epoch for "today". Due dates are parsed at UTC midnight, so compare at that grain. */
function todayUtcMs(): number {
	const now = new Date();
	return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/**
 * Parse a `yyyy-mm-dd` due-date string to a UTC-midnight Date (so it round-trips with issues.ts
 * `toDateInput()`), rejecting a malformed value and a past date. `existingDueMs` grandfathers an
 * already-set past due date on edit — keeping an overdue incident's original date is fine, only
 * NEWLY setting a past date is rejected. An empty string means "no due date" → `{ dueDate: null }`.
 *
 * Shared by the incident board's `parseIssueInput` AND the Sentry `?/track` action so the two apply
 * identical rules — they had drifted (track NaN-checked only, never rejecting past dates) (M4a).
 */
export function parseDueDate(
	raw: string,
	existingDueMs?: number | null
): { dueDate: Date | null } | { error: string } {
	const trimmed = raw.trim();
	if (!trimmed) return { dueDate: null };
	if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return { error: 'Invalid due date.' };
	const [y, mo, da] = trimmed.split('-').map(Number);
	const d = new Date(Date.UTC(y, mo - 1, da));
	if (Number.isNaN(d.getTime())) return { error: 'Invalid due date.' };
	if (d.getUTCFullYear() !== y || d.getUTCMonth() + 1 !== mo || d.getUTCDate() !== da) {
		return { error: 'Invalid due date.' };
	}
	if (d.getTime() < todayUtcMs() && d.getTime() !== existingDueMs) {
		return { error: 'Due date cannot be in the past.' };
	}
	return { dueDate: d };
}
