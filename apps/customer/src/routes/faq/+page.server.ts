import { asc, eq } from 'drizzle-orm';
import { faqs } from '@veent/db';
import { db } from '$lib/server/db';
import type { PageServerLoad } from './$types';

/**
 * The Help/FAQ page reads from the DB (admin-managed via the admin Content Management
 * section) instead of a hardcoded array — only PUBLISHED entries, in the admin-set order.
 */
export const load: PageServerLoad = async () => {
	const rows = await db
		.select({ id: faqs.id, q: faqs.question, a: faqs.answer })
		.from(faqs)
		.where(eq(faqs.isPublished, true))
		.orderBy(asc(faqs.sortOrder), asc(faqs.id));
	return { faqs: rows };
};
