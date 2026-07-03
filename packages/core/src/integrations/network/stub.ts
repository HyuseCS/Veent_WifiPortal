import type {
	NetworkController,
	GrantInput,
	InterfaceLimitInput,
	DeviceHostAccessInput,
	RevokeScope
} from './types';

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
		async revoke(macAddress: string, scope: RevokeScope): Promise<void> {
			log(`[network:stub] REVOKE ${macAddress} (${'all' in scope ? 'all' : scope.tag})`);
		},
		async applyInterfaceLimit(input: InterfaceLimitInput): Promise<void> {
			const cap = (k: number | null) => (k == null ? '∞' : `${k}kbps`);
			log(
				`[network:stub] LIMIT ${input.apName} (${input.interfaceName}) ` +
					`↓${cap(input.downKbps)} ↑${cap(input.upKbps)}`
			);
		},
		async resolveMacByIp(ipAddress: string): Promise<string | null> {
			// No router to query in dev — the admin-grant path no-ops gracefully.
			log(`[network:stub] RESOLVE-MAC ${ipAddress} → null`);
			return null;
		},
		async openHostAccessForDevice(input: DeviceHostAccessInput): Promise<{ ipAddress: string | null }> {
			// No router / no device IP in dev — log intent so the checkout flow is traceable.
			log(`[network:stub] OPEN-HOST-ACCESS ${input.macAddress} → ${input.hosts.join(', ')}`);
			return { ipAddress: null };
		},
		async sweepHostAccess(): Promise<number> {
			return 0;
		},
		async sweepAdminBindings(): Promise<string[]> {
			return [];
		}
	};
}
