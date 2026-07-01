import { describe, it, expect } from 'vitest';
import { cronIpAllowed, clientIp } from './rateLimit';

// Minimal RequestEvent stand-in exposing just getClientAddress.
const evt = (ip: string) => ({ getClientAddress: () => ip }) as never;

describe('clientIp', () => {
	it('strips the IPv4-mapped-IPv6 prefix', () => {
		expect(clientIp(evt('::ffff:10.0.0.5'))).toBe('10.0.0.5');
		expect(clientIp(evt('203.0.113.7'))).toBe('203.0.113.7');
	});
});

describe('cronIpAllowed', () => {
	it('allows any IP when the allowlist is unset/empty', () => {
		expect(cronIpAllowed(evt('1.2.3.4'), undefined)).toBe(true);
		expect(cronIpAllowed(evt('1.2.3.4'), '')).toBe(true);
		expect(cronIpAllowed(evt('1.2.3.4'), '  ,  ')).toBe(true);
	});

	it('allows only listed IPs when set (trimming entries)', () => {
		expect(cronIpAllowed(evt('10.0.0.1'), '10.0.0.1, 10.0.0.2')).toBe(true);
		expect(cronIpAllowed(evt('10.0.0.2'), '10.0.0.1, 10.0.0.2')).toBe(true);
		expect(cronIpAllowed(evt('10.0.0.9'), '10.0.0.1, 10.0.0.2')).toBe(false);
	});

	it('matches after stripping the IPv6-mapped prefix', () => {
		expect(cronIpAllowed(evt('::ffff:10.0.0.1'), '10.0.0.1')).toBe(true);
	});
});
