/**
 * Small pure helpers for the admin TOTP flow, shared by the /login/2fa and
 * /enroll-2fa actions (and unit-tested in twoFactor.test.ts). The better-auth
 * two-factor plugin does the cryptography; these only classify input and parse
 * the enrollment URI.
 */

/**
 * A 6-digit numeric string is a TOTP code; anything else is treated as a backup
 * code. Drives which verify endpoint a login attempt is routed to.
 */
export function isTotpCode(code: string): boolean {
	return /^\d{6}$/.test(code.trim());
}

/**
 * Pull the shared `secret` out of an `otpauth://` enrollment URI for the
 * manual-entry fallback (when the user can't scan the QR). Returns '' if absent.
 */
export function secretFromTotpUri(uri: string): string {
	try {
		return new URL(uri).searchParams.get('secret') ?? '';
	} catch {
		return '';
	}
}
