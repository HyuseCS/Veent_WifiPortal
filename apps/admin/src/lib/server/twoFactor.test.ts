import { describe, it, expect } from 'vitest';
import { isTotpCode, secretFromTotpUri } from './twoFactor';

/**
 * Pins the input-classification used on the auth path: which verify endpoint a
 * login code is routed to (TOTP vs backup), and the manual-entry secret parsed
 * out of the enrollment URI. The cryptography itself is better-auth's.
 */
describe('isTotpCode', () => {
	it('treats a 6-digit numeric string as a TOTP', () => {
		expect(isTotpCode('123456')).toBe(true);
		expect(isTotpCode(' 000000 ')).toBe(true); // trimmed
	});

	it('treats anything else as a backup code', () => {
		expect(isTotpCode('12345')).toBe(false); // too short
		expect(isTotpCode('1234567')).toBe(false); // too long
		expect(isTotpCode('abcdef')).toBe(false); // non-numeric
		expect(isTotpCode('ABCD-1234')).toBe(false); // backup-code shape
		expect(isTotpCode('')).toBe(false);
	});
});

describe('secretFromTotpUri', () => {
	it('extracts the secret query param from an otpauth URI', () => {
		const uri = 'otpauth://totp/RADIUS%20Admin:a@b.com?secret=JBSWY3DPEHPK3PXP&issuer=RADIUS%20Admin';
		expect(secretFromTotpUri(uri)).toBe('JBSWY3DPEHPK3PXP');
	});

	it('returns empty string when there is no secret or the URI is malformed', () => {
		expect(secretFromTotpUri('otpauth://totp/x?issuer=y')).toBe('');
		expect(secretFromTotpUri('not a uri')).toBe('');
	});
});
