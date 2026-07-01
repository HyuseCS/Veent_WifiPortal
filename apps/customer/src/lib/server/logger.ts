import { captureHandled } from '@veent/core/observability';

/**
 * Thin scoped logger — the single seam the customer app logs through, so `captureException`
 * (Sentry) lands in ONE place instead of being sprinkled across call sites. Mirrors the admin
 * seam. `logger('grant').info(...)` prints `[grant] …`.
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
			const err =
				args.find((a): a is Error => a instanceof Error) ??
				new Error(`${prefix} ${args.map(String).join(' ')}`);
			captureHandled(err, { tags: { scope } });
		}
	};
}
