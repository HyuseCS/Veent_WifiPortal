import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** /content has no page of its own — land on the first sub-section. */
export const load: PageServerLoad = () => redirect(307, '/content/packages');
