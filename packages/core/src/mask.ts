// Device MAC and client IP are PII. observability.ts scrubs them from Sentry events, but that hook
// doesn't touch console.* — so mask them here before they reach stdout/log files (L-8). Keep enough
// tail/head to correlate a session without persisting the full identifier.
export function maskMac(mac: string | null | undefined): string | null {
	if (!mac) return mac ?? null;
	return mac.replace(/^(?:[0-9A-Fa-f]{2}:){4}/, '**:**:**:**:'); // keep the last two octets
}
export function maskIp(ip: string | null | undefined): string | null {
	if (!ip) return ip ?? null;
	const v4 = ip.replace(/^::ffff:/i, '').match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
	return v4 ? `${v4[1]}.${v4[2]}.*.*` : ip.replace(/[^:]+(?=:*$)/, '*'); // v4: keep /16; else mask tail
}
