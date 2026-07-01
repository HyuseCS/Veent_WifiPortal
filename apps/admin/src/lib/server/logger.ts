import { captureHandled } from '@veent/core/observability';

/**
 * Thin scoped logger — the single seam the admin app logs through, so `captureException`
 * (Sentry) lands in ONE place instead of being sprinkled across call sites.
 * `logger('sse').info(...)` prints `[sse] …`, replacing the hand-written `console.x('[scope] …')`.
 *
 * `.error(...)` ALSO reports to Sentry as a handled `warning` (tagged with the scope) — every
 * failure the app catches and logs here is a graceful degradation, not a crash (real crashes come
 * through `handleError` uncaught). `.info`/`.warn` stay console-only. Migrate a catch site into
 * Sentry simply by switching its `console.error` to `log.error`.
 */
export function logger(scope: string) {
	const prefix = `[${scope}]`;
	return {
		info: (...args: unknown[]) => console.info(prefix, ...args),
		warn: (...args: unknown[]) => console.warn(prefix, ...args),
		error: (...args: unknown[]) => {
			console.error(prefix, ...args);
			// Report the first Error arg (preserves stack); else synthesize one from the message.
			const err =
				args.find((a): a is Error => a instanceof Error) ??
				new Error(`${prefix} ${args.map(String).join(' ')}`);
			// Keep the call-site message (the non-Error args) as Sentry context — otherwise an
			// Issue triages with just the bare error and loses "what were we doing" (e.g. '2FA enable …').
			const detail = args
				.filter((a) => !(a instanceof Error))
				.map(String)
				.join(' ')
				.trim();
			captureHandled(err, { tags: { scope }, extra: detail ? { detail } : undefined });
		}
	};
}
