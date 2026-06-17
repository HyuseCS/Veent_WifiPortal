/**
 * Philippine mobile-number helpers. The portal asks guests for a phone number
 * (the OTP login identifier), so normalize the common local formats to E.164:
 *
 *   0917 123 4567   →  +639171234567
 *   +63 917 1234567 →  +639171234567
 *   639171234567    →  +639171234567
 *
 * Returns null when the input isn't a valid PH mobile number.
 */
export function normalizePhone(input: string): string | null {
	const digits = input.replace(/[\s()\-.]/g, '');
	// 0XXXXXXXXXX (local, leading 0)
	let match = digits.match(/^0(9\d{9})$/);
	if (match) return `+63${match[1]}`;
	// +63 / 63 prefixed
	match = digits.match(/^\+?63(9\d{9})$/);
	if (match) return `+63${match[1]}`;
	return null;
}
