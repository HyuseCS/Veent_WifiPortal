import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import * as Sentry from '@sentry/sveltekit';
import type { Actions, PageServerLoad } from './$types';

// Dev-only Sentry verification page. 404s in production so it never ships as a live route —
// gated in `load` AND in every action (a direct POST must not reach the throw in prod).
function ensureDev() {
	if (!dev) throw error(404, 'Not found');
}

export const load: PageServerLoad = () => {
	ensureDev();
};

export const actions: Actions = {
	// The DEFINITIVE capture test: a server-side throw goes Node → Sentry directly, bypassing
	// browser ad-blockers / tracking-protection / CORS. If this lands in Issues, capture works.
	serverError: () => {
		ensureDev();
		throw new Error('Sentry server test: intentional server-side error');
	},

	// Performance/delay test: a deliberately slow span. Proves the tracing pipeline surfaces
	// timed operations in the transaction waterfall (same mechanism as the Maya/router spans).
	serverSpan: async () => {
		ensureDev();
		await Sentry.startSpan({ name: 'sentry-test.server-slow-op', op: 'test' }, async () => {
			await new Promise((r) => setTimeout(r, 1500));
		});
		return { ok: true, kind: 'server-span' };
	}
};
