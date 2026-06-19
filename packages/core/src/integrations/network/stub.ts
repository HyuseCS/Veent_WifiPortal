import type { NetworkController, GrantInput } from './types';

/**
 * No-op network controller for local dev / until the real integration strategy
 * is chosen. Logs intent instead of touching hardware, so the full app flow
 * (sessions, grants, the revoke cron) is exercisable end-to-end without a router.
 *
 * Swap for a real impl (UniFi/Omada/RADIUS/grant_url) behind the same interface.
 */
export function createStubNetworkController(
	log: (msg: string) => void = console.log
): NetworkController {
	return {
		name: 'stub',
		async grant(input: GrantInput): Promise<void> {
			log(
				`[network:stub] GRANT ${input.macAddress} for ${input.durationMinutes}m` +
					(input.bandwidthMbps ? ` @ ${input.bandwidthMbps}Mbps` : '') +
					(input.tag ? ` (${input.tag})` : '')
			);
		},
		async revoke(macAddress: string): Promise<void> {
			log(`[network:stub] REVOKE ${macAddress}`);
		},
		async resolveMacByIp(ipAddress: string): Promise<string | null> {
			// No router to query in dev — the admin-grant path no-ops gracefully.
			log(`[network:stub] RESOLVE-MAC ${ipAddress} → null`);
			return null;
		}
	};
}
