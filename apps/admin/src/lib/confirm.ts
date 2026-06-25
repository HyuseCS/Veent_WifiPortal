/**
 * Type-to-confirm gate shared by client (button enable) and server (enforcement)
 * for high-privilege actions like promoting an admin to owner. Client-safe (no
 * server deps) so both sides import the SAME rule — the typed value can't pass one
 * but fail the other.
 */

/** Case-insensitive, whitespace-trimmed equality. Empty input never matches. */
export function namesMatch(typed: string, expected: string): boolean {
	const a = typed.trim().toLowerCase();
	const b = expected.trim().toLowerCase();
	return a !== '' && a === b;
}
