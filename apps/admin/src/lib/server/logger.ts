/**
 * Thin scoped logger — the single seam the admin app logs through, so a future
 * `captureException` (Sentry, see docs/ADMIN_AUDIT_AND_SENTRY.md) lands in ONE place
 * instead of being sprinkled across call sites. `logger('sse').info(...)` prints
 * `[sse] …`, replacing the hand-written `console.x('[scope] …')` convention.
 *
 * ponytail: wrapper only — no levels/transports/config until something actually needs
 * them. It maps straight onto console today.
 *
 * NB: the error/failure-handling log sites (email-send failures, grant failures, …)
 * are intentionally NOT migrated here yet — they belong to the in-flight "error
 * handling & resilience" work (audit #2) and migrating them now would collide. This
 * seam is ready for that pass to adopt.
 */
export function logger(scope: string) {
	const prefix = `[${scope}]`;
	return {
		info: (...args: unknown[]) => console.info(prefix, ...args),
		warn: (...args: unknown[]) => console.warn(prefix, ...args),
		error: (...args: unknown[]) => console.error(prefix, ...args)
	};
}
