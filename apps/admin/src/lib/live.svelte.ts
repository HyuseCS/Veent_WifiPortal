import { browser } from '$app/environment';
import type { DashboardSnapshot } from '$lib/types';

export type LiveStatus = 'connecting' | 'live' | 'offline';

// Shared SSE connection (business rule #5). One EventSource for the whole app,
// ref-counted so the topbar's status indicator and the dashboard share a single
// stream instead of opening one each. The stream carries the whole dashboard
// snapshot, pushed event-driven by Postgres triggers (no polling).
let status = $state<LiveStatus>('connecting');
let snapshot = $state<DashboardSnapshot | null>(null);
let es: EventSource | null = null;
let refs = 0;

export const live = {
	get status() {
		return status;
	},
	get snapshot() {
		return snapshot;
	}
};

/** Open the shared stream while at least one component needs it; closes when the
 * last consumer unmounts. Use as `$effect(connectLive)`. */
export function connectLive() {
	if (!browser) return;
	if (refs++ === 0) {
		es = new EventSource('/api/connected');
		es.onopen = () => (status = 'live');
		es.onmessage = (event) => {
			status = 'live';
			try {
				snapshot = JSON.parse(event.data) as DashboardSnapshot;
			} catch {
				// ignore malformed frame; next push replaces it
			}
		};
		// EventSource auto-reconnects: CLOSED means it gave up, else it's retrying.
		es.onerror = () => (status = es?.readyState === EventSource.CLOSED ? 'offline' : 'connecting');
	}
	return () => {
		if (--refs === 0) {
			es?.close();
			es = null;
		}
	};
}
