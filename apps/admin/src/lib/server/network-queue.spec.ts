import { describe, it, expect } from 'vitest';
import { formatQueueRate, ipv4NetworkOf } from '@veent/core';

// Pure helpers behind the per-AP bandwidth queue (mikrotik.ts). The live /queue/simple
// calls can't be exercised without a router, but the rate formatting and subnet math —
// the parts most likely to be wrong — are unit-testable here.

describe('formatQueueRate', () => {
	it('renders Kbps as a decimal-k RouterOS rate token', () => {
		expect(formatQueueRate(512)).toBe('512k'); // 512 kbit/s
		expect(formatQueueRate(50_000)).toBe('50000k'); // 50 Mbit/s
	});

	it('treats null as unlimited (0) for an asymmetric cap side', () => {
		expect(formatQueueRate(null)).toBe('0');
	});

	it('rounds fractional Kbps to whole kilobits', () => {
		expect(formatQueueRate(1500.6)).toBe('1501k');
	});
});

describe('ipv4NetworkOf', () => {
	it('masks a host address down to its network', () => {
		expect(ipv4NetworkOf('10.210.0.1/18')).toBe('10.210.0.0/18');
		expect(ipv4NetworkOf('192.168.1.55/24')).toBe('192.168.1.0/24');
		expect(ipv4NetworkOf('172.16.34.9/16')).toBe('172.16.0.0/16');
	});

	it('handles edge prefixes without sign-bit corruption', () => {
		// /1 exercises the high bit — the >>> 0 coercions must keep it unsigned.
		expect(ipv4NetworkOf('200.0.0.0/1')).toBe('128.0.0.0/1');
		expect(ipv4NetworkOf('8.8.8.8/32')).toBe('8.8.8.8/32');
		expect(ipv4NetworkOf('8.8.8.8/0')).toBe('0.0.0.0/0');
	});

	it('returns null on malformed or non-IPv4 input', () => {
		expect(ipv4NetworkOf('not-an-ip')).toBeNull();
		expect(ipv4NetworkOf('10.0.0.1')).toBeNull(); // no prefix
		expect(ipv4NetworkOf('10.0.0.1/33')).toBeNull(); // prefix out of range
		expect(ipv4NetworkOf('10.0.0.256/24')).toBeNull(); // octet out of range
		expect(ipv4NetworkOf('10.0.0/24')).toBeNull(); // too few octets
	});
});
