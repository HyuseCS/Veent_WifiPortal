import { fail, type RequestEvent } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { requireOwner as ownerGate } from '$lib/server/auth-guard';
import { verifyStepUp } from '$lib/server/step-up';
import {
	listFaqs,
	createFaq,
	updateFaq,
	setFaqPublished,
	deleteFaq,
	type FaqInput
} from '$lib/server/faq';
import type { Actions, PageServerLoad } from './$types';

// Section-level owner gate lives in content/+layout.server.ts; loads inherit it. Actions
// re-assert owner per-handler (loads don't run on form POSTs).
export const load: PageServerLoad = async () => ({ faqs: await listFaqs(db) });

const requireOwner = (userId: string | undefined) =>
	ownerGate(userId, 'Only the owner can manage content.');

function parseFaq(form: FormData): { input: FaqInput } | { error: string } {
	const question = String(form.get('question') ?? '').trim();
	const answer = String(form.get('answer') ?? '').trim();
	if (!question) return { error: 'Question is required.' };
	if (!answer) return { error: 'Answer is required.' };
	const rawSort = String(form.get('sortOrder') ?? '').trim();
	const sortOrder = rawSort === '' ? 0 : Number(rawSort);
	if (!Number.isFinite(sortOrder)) return { error: 'Order must be a number.' };
	return {
		input: {
			question,
			answer,
			sortOrder: Math.trunc(sortOrder),
			isPublished: form.get('isPublished') === 'on' || form.get('isPublished') === 'true'
		}
	};
}

function faqId(form: FormData): number | null {
	const id = Number(form.get('id'));
	return Number.isInteger(id) && id > 0 ? id : null;
}

// Every FAQ write is owner-only AND TOTP step-up-gated (a code per save). The code is the
// LAST gate — after field validation, so a rotating code isn't wasted on a form error.
const stepUp = (event: RequestEvent, code: FormDataEntryValue | null, action: string) =>
	verifyStepUp(event, String(code ?? ''), { scope: 'admin_content_step_up', action });

export const actions: Actions = {
	create: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;
		const form = await event.request.formData();
		const parsed = parseFaq(form);
		if ('error' in parsed) return fail(400, { action: 'create', error: parsed.error });
		const denied2 = await stepUp(event, form.get('code'), 'create');
		if (denied2) return denied2;
		const id = await createFaq(db, parsed.input);
		return { ok: true, action: 'create', id };
	},

	update: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;
		const form = await event.request.formData();
		const id = faqId(form);
		if (id == null) return fail(400, { action: 'update', error: 'Invalid entry.' });
		const parsed = parseFaq(form);
		if ('error' in parsed) return fail(400, { action: 'update', error: parsed.error, id });
		const denied2 = await stepUp(event, form.get('code'), 'update');
		if (denied2) return denied2;
		await updateFaq(db, id, parsed.input);
		return { ok: true, action: 'update', id };
	},

	togglePublished: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;
		const form = await event.request.formData();
		const id = faqId(form);
		if (id == null) return fail(400, { action: 'togglePublished', error: 'Invalid entry.' });
		const denied2 = await stepUp(event, form.get('code'), 'togglePublished');
		if (denied2) return denied2;
		await setFaqPublished(db, id, form.get('isPublished') === 'true');
		return { ok: true, action: 'togglePublished', id };
	},

	remove: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;
		const form = await event.request.formData();
		const id = faqId(form);
		if (id == null) return fail(400, { action: 'remove', error: 'Invalid entry.' });
		const denied2 = await stepUp(event, form.get('code'), 'remove');
		if (denied2) return denied2;
		await deleteFaq(db, id);
		return { ok: true, action: 'remove', id };
	}
};
