// Shared clickable-header sort state for admin tables (Users, Transactions, Dashboard).
// Holds the active key + direction and the toggle reflex (click a header to sort, click it
// again to flip). The comparator stays per-table — that's the genuinely different part — so
// `apply` takes one. `defaultDir` sets the first-click direction per column (e.g. biggest /
// newest first). With no active key the list is returned untouched, preserving server order.
export function createSort<K extends string>(defaultDir: Record<K, 'asc' | 'desc'>) {
	let key = $state<K | null>(null);
	let dir = $state<'asc' | 'desc'>('asc');
	return {
		get key() {
			return key;
		},
		get dir() {
			return dir;
		},
		toggle(k: K) {
			if (key === k) dir = dir === 'asc' ? 'desc' : 'asc';
			else {
				key = k;
				dir = defaultDir[k];
			}
		},
		/** Sorted copy of `list` via `cmp` (ascending semantics; direction is applied here). */
		apply<T>(list: T[], cmp: (a: T, b: T, k: K) => number): T[] {
			if (!key) return list;
			const k = key;
			const d = dir === 'asc' ? 1 : -1;
			return [...list].sort((a, b) => cmp(a, b, k) * d);
		}
	};
}
