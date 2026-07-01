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
