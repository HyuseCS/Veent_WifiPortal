/**
 * FAQ Contents (CMS) — admin CRUD over the `faqs` table that backs the customer Help page.
 * The customer page shows only published entries (ordered by sortOrder, then id); admins see
 * drafts + published here. Editing copy here is live to guests with no deploy.
 */
import { asc, eq } from 'drizzle-orm';
import { type DB, faqs } from '@veent/db';

/** An FAQ row in the admin management table. */
export interface AdminFaqRow {
	id: number;
	question: string;
	answer: string;
	sortOrder: number;
	isPublished: boolean;
}

/** Validated fields for an upsert. */
export interface FaqInput {
	question: string;
	answer: string;
	sortOrder: number;
	isPublished: boolean;
}

/** All FAQs (published + drafts), in customer display order. */
export async function listFaqs(db: DB): Promise<AdminFaqRow[]> {
	const rows = await db.select().from(faqs).orderBy(asc(faqs.sortOrder), asc(faqs.id));
	return rows.map((r) => ({
		id: r.id,
		question: r.question,
		answer: r.answer,
		sortOrder: r.sortOrder,
		isPublished: r.isPublished
	}));
}

export async function createFaq(db: DB, input: FaqInput): Promise<number> {
	const [row] = await db.insert(faqs).values(input).returning({ id: faqs.id });
	return row.id;
}

export async function updateFaq(db: DB, id: number, input: FaqInput): Promise<void> {
	await db
		.update(faqs)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(faqs.id, id));
}

export async function setFaqPublished(db: DB, id: number, isPublished: boolean): Promise<void> {
	await db
		.update(faqs)
		.set({ isPublished, updatedAt: new Date() })
		.where(eq(faqs.id, id));
}

export async function deleteFaq(db: DB, id: number): Promise<void> {
	await db.delete(faqs).where(eq(faqs.id, id));
}
