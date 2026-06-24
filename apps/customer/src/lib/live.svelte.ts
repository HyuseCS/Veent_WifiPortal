import { browser } from '$app/environment';
import type { AccountView } from '$lib/server/account-view';

// Live per-account dashboard slice over SSE (business rule #5). One EventSource pushes a
// fresh view whenever this account changes from ANY device — pause/resume, a purchase, a
// device bind/unbind, a balance change. The dashboard reads `liveAccount.view` and falls
// back to the page `load` data until the first frame arrives. (Type-only import of the
// server view shape — erased at build, so no server code reaches the client.)
let view = $state<AccountView | null>(null);

export const liveAccount = {
	get view() {
		return view;
	}
};

/**
 * Open the account stream for the lifetime of the caller. Use as
 * `$effect(() => connectAccountLive(mac))` — re-opens if `mac` changes, closes on unmount.
 * `mac` only flags the current device in the pushed device list; the stream is always
 * scoped server-side to the authenticated user.
 */
export function connectAccountLive(mac: string) {
	if (!browser) return;
	const url = mac ? `/api/account/stream?mac=${encodeURIComponent(mac)}` : '/api/account/stream';
	const es = new EventSource(url);
	es.onmessage = (event) => {
		try {
			view = JSON.parse(event.data) as AccountView;
		} catch {
			// ignore malformed frame; the next push replaces it
		}
	};
	// EventSource auto-reconnects on a dropped connection; nothing to do on error.
	return () => {
		es.close();
		view = null;
	};
}
