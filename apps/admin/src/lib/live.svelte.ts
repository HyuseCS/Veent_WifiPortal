import { browser } from '$app/environment';
import type { ActiveSession } from '$lib/types';

export type LiveStatus = 'connecting' | 'live' | 'offline';

// Shared SSE connection (business rule #5). One EventSource for the whole app,
// ref-counted so the topbar's status indicator and the dashboard's session table
// share a single stream instead of opening one each.
let status = $state<LiveStatus>('connecting');
let sessions = $state<ActiveSession[] | null>(null);
let es: EventSource | null = null;
let refs = 0;

export const live = {
	get status() {
		return status;
	},
	get sessions() {
		return sessions;
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
				sessions = JSON.parse(event.data) as ActiveSession[];
			} catch {
				// ignore malformed frame; next tick replaces it
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
