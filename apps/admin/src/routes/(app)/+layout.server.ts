import type { LayoutServerLoad } from './$types';

// TEMP: auth guard bypassed for UI testing — restore before merge.
export const load: LayoutServerLoad = (event) => {
	return {
		user: event.locals.user ?? { id: 'mock', name: 'Test Operator', email: 'test@veent.io' }
	};
};
