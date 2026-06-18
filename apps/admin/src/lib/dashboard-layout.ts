/**
 * Dashboard arrangement options, shared between the header's layout switcher and the
 * dashboard grid. The choice persists in a cookie (read SSR-side in the (app) layout
 * load so the right arrangement renders without a flash).
 */
export const DASH_LAYOUTS = ['bento', 'split', 'stacked'] as const;
export type DashLayout = (typeof DASH_LAYOUTS)[number];

export const DASH_LAYOUT_COOKIE = 'veent-dash-layout';

/** Coerce an untrusted cookie value to a known layout (defaults to bento). */
export function parseDashLayout(value: string | undefined): DashLayout {
	return DASH_LAYOUTS.includes(value as DashLayout) ? (value as DashLayout) : 'bento';
}

/** Context shared from the (app) layout to both the header switcher and the dashboard page. */
export const DASH_LAYOUT_CTX = Symbol('dash-layout');
export interface DashLayoutCtx {
	readonly current: DashLayout;
	choose(value: DashLayout): void;
}
