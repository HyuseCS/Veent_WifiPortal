import { describe, it, expect } from 'vitest';
import { PAYMENT_HOSTS, PROBE_DENIES } from './walled-garden-config';

// D-CAUTION guard: no global PAYMENT_HOSTS entry may equal a PROBE_DENIES host. A collision would
// silently re-open a captive-portal probe host (walled-garden is first-match top-to-bottom; an allow
// sitting under a deny for the SAME host is redundant, but dumping a probe host into PAYMENT_HOSTS —
// e.g. www.google.com — is exactly how the "Connected"-then-reverts flap gets reintroduced). This
// must FAIL the build if anyone later adds a Google-family probe host to PAYMENT_HOSTS.
describe('walled-garden config — PAYMENT_HOSTS ∩ PROBE_DENIES = ∅', () => {
	it('has no PAYMENT_HOSTS entry that collides with a PROBE_DENIES host', () => {
		const denyHosts = PROBE_DENIES.map((d) => d.host.toLowerCase());
		const collisions = PAYMENT_HOSTS.filter((h) => denyHosts.includes(h.toLowerCase()));
		expect(collisions).toEqual([]);
	});
});
