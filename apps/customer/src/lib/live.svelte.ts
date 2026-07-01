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
 * Drop the cached live frame so the dashboard falls back to fresh `load` data until the next SSE
 * push. Call right after a local action's `update()` (buy / free / reconnect): the action just
 * re-ran `load`, so `data` is authoritative, but a STALE live frame would otherwise keep
 * overriding it (`live ?? data`) — the mobile EventSource often doesn't redeliver across the
 * grant's network transition, which is why the page looked stuck until a manual refresh.
 */
export function resetAccountLive() {
	view = null;
}

/**
 * Open the account stream for the lifetime of the caller. Use as
 * `$effect(() => connectAccountLive(mac))` — re-opens if `mac` changes, closes on unmount.
 * `mac` only flags the current device in the pushed device list; the stream is always
 * scoped server-side to the authenticated user.
 */
export function connectAccountLive(mac: string) {
	if (!browser) return;
	// Clear any stale frame held over from a previous connection/visit so the dashboard uses fresh
	// `load` data until THIS connection pushes a current frame. Without this, `live ?? data` keeps
	// rendering a pre-action frame (e.g. the not-yet-connected state from before a buy) — the page
	// then looks stuck until a manual refresh, even though `load` already returned the live state.
	view = null;
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
