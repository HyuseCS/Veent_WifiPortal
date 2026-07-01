/**
 * Minimal RFC 6238 TOTP generator for the E2E harness — produces the same codes
 * better-auth's two-factor plugin verifies (HMAC-SHA1, 6 digits, 30s period). The
 * enrollment URI's `secret` param is `base32(rawSecret)` and better-auth HMACs the
 * raw secret bytes, so we base32-decode the manual-entry key to recover the HMAC key.
 *
 * stdlib only (node:crypto) — no otplib dependency. `selfTest()` validates the crypto
 * against the RFC 4226 HOTP test vectors before the harness relies on it.
 * Run standalone: `bun run e2e/totp.ts`.
 */
import { createHmac } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 decode (no padding required); matches @better-auth/utils base32. */
function base32Decode(input: string): Buffer {
	const map = new Map([...BASE32_ALPHABET].map((c, i) => [c, i]));
	const out: number[] = [];
	let buffer = 0;
	let bits = 0;
	for (const ch of input.replace(/=+$/, '')) {
		const v = map.get(ch);
		if (v === undefined) throw new Error(`Invalid base32 character: ${ch}`);
		buffer = (buffer << 5) | v;
		bits += 5;
		if (bits >= 8) {
			bits -= 8;
			out.push((buffer >> bits) & 0xff);
		}
	}
	return Buffer.from(out);
}

/** RFC 4226 HOTP for a given key + counter. */
function hotp(key: Buffer, counter: number): string {
	const buf = Buffer.alloc(8);
	buf.writeBigUInt64BE(BigInt(counter));
	const h = createHmac('sha1', key).update(buf).digest();
	const offset = h[h.length - 1] & 0x0f;
	const bin =
		((h[offset] & 0x7f) << 24) |
		((h[offset + 1] & 0xff) << 16) |
		((h[offset + 2] & 0xff) << 8) |
		(h[offset + 3] & 0xff);
	return (bin % 1_000_000).toString().padStart(6, '0');
}

/** Current 6-digit TOTP for a base32-encoded secret (the manual-entry key). */
export function totp(base32Secret: string, now: number = Date.now()): string {
	const key = base32Decode(base32Secret.trim());
	return hotp(key, Math.floor(now / 30_000));
}

/** Validate the implementation against the RFC 4226 published HOTP test vectors. */
export function selfTest(): void {
	// base32 of ASCII "12345678901234567890" (the RFC 4226 seed).
	const key = base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
	if (key.toString('ascii') !== '12345678901234567890') {
		throw new Error('TOTP self-test: base32 decode mismatch');
	}
	const expected = ['755224', '287082', '359152', '969429', '338314', '254676'];
	expected.forEach((want, counter) => {
		const got = hotp(key, counter);
		if (got !== want) throw new Error(`TOTP self-test: HOTP(${counter}) = ${got}, want ${want}`);
	});
}

// Standalone self-check: `bun run e2e/totp.ts` (no test framework needed).
if (import.meta.main) {
	selfTest();
	console.log('✓ TOTP self-test passed (RFC 4226 vectors)');
}
