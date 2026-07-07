// Small client-side time/MAC formatting helpers shared by the dashboard cards.

/** `123456` ms → `0:02:03`. Clamps negatives to zero so an elapsed countdown reads 0:00:00. */
export function formatHMS(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// Last 3 octets of a MAC — client mirror of $lib/server/account-view's `macTail` (server code
// can't be imported into the client bundle).
export function macTailOf(m: string | null): string | null {
	if (!m) return null;
	const parts = m.split(':');
	return parts.length >= 3 ? parts.slice(-3).join(':') : m;
}
