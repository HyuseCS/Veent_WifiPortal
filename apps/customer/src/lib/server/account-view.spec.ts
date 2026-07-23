import { describe, it, expect } from 'vitest';
import { shapeDevices } from './account-view';

/**
 * MAC-trust grant fix (AC3/AC4) — `shapeDevices` treats a MAC match as "bound" ONLY when the
 * resolved MAC is verified (live). An unverified (fallback) match is reported as
 * `thisDeviceUnverified` so the dashboard prompts a reconnect instead of falsely claiming online.
 * Pure function — no mocks needed.
 */

const THIS_MAC = 'AA:BB:CC:DD:EE:01';

// Minimal ActiveAccess-shaped stub: shapeDevices only reads `.devices` (id, macAddress, boundAt,
// lastSeenAt). Cast through unknown to satisfy the ActiveAccess type without the full shape.
function accessWith(macAddress: string | null) {
	const now = new Date();
	return {
		devices: [{ id: 1, macAddress, boundAt: now, lastSeenAt: now }]
	} as unknown as Parameters<typeof shapeDevices>[0];
}

describe('shapeDevices — verified-gated bound flag (AC3/AC4)', () => {
	it('verified (default) + matching device ⇒ thisDeviceBound true, thisDeviceUnverified false', () => {
		const d = shapeDevices(accessWith(THIS_MAC), THIS_MAC, 3);
		expect(d.thisDeviceBound).toBe(true);
		expect(d.thisDeviceUnverified).toBe(false);
	});

	it('verified: false + matching device ⇒ NOT bound, but flagged unverified (loop-break)', () => {
		const d = shapeDevices(accessWith(THIS_MAC), THIS_MAC, 3, false);
		expect(d.thisDeviceBound).toBe(false);
		expect(d.thisDeviceUnverified).toBe(true);
	});

	it('verified: false + NO matching device ⇒ neither bound nor unverified (no false nag, AC4)', () => {
		const d = shapeDevices(accessWith('FF:FF:FF:FF:FF:FF'), THIS_MAC, 3, false);
		expect(d.thisDeviceBound).toBe(false);
		expect(d.thisDeviceUnverified).toBe(false);
	});

	it('verified: true + NO matching device ⇒ not bound, not unverified', () => {
		const d = shapeDevices(accessWith('FF:FF:FF:FF:FF:FF'), THIS_MAC, 3, true);
		expect(d.thisDeviceBound).toBe(false);
		expect(d.thisDeviceUnverified).toBe(false);
	});
});
