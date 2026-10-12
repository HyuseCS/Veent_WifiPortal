import { describe, it, expect } from 'vitest';
import { maskIp, maskMac } from './mask';

describe('maskMac', () => {
	it('keeps the last two octets', () => {
		expect(maskMac('AA:BB:CC:DD:35:8F')).toBe('**:**:**:**:35:8F');
	});
	it('passes null and empty through as null', () => {
		expect(maskMac(null)).toBeNull();
		expect(maskMac(undefined)).toBeNull();
		expect(maskMac('')).toBe('');
	});
});

describe('maskIp', () => {
	it('keeps the /16 of an IPv4', () => {
		expect(maskIp('10.210.4.7')).toBe('10.210.*.*');
	});
	it('masks the tail of an IPv6', () => {
		expect(maskIp('2001:db8:0:1::abcd')).not.toContain('abcd');
		expect(maskIp('2001:db8:0:1::abcd')).toContain('*');
		expect(maskIp('fe80::1')).toBe('fe80::*');
	});
	it('masks an IPv4-mapped IPv6 as IPv4', () => {
		expect(maskIp('::ffff:10.210.4.7')).toBe('10.210.*.*');
	});
	it('passes null and empty through as null', () => {
		expect(maskIp(null)).toBeNull();
		expect(maskIp('')).toBe('');
	});
});
