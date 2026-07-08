// Shared, ref-counted "an inline editor is open" flag.
//
// While active, the Networks page suppresses page-level scroll-snap (so a snap re-align on
// scroll-end — or a reflow from a live SSE frame — can't yank the user mid-edit) and pauses
// swapping in live data (so a background push can't reflow or reset the fields being edited).
// Ref-counted so several open editors compose (the lock lifts only when the last one closes).
let count = $state(0);

export const editLock = {
	get active() {
		return count > 0;
	},
	/** Mark an editor open; call the returned fn once when it closes. Idempotent per handle. */
	acquire(): () => void {
		count++;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			count = Math.max(0, count - 1);
		};
	}
};
