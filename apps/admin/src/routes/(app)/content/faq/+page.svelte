<script lang="ts">
	import { enhance } from '$app/forms';
	import { Card, Button, Field } from '$lib/components/ui';
	import StepUpDialog from '$lib/components/feature/StepUpDialog.svelte';
	import Plus from 'lucide-svelte/icons/plus';
	import Pencil from 'lucide-svelte/icons/pencil';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import X from 'lucide-svelte/icons/x';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Per-save MFA: edit form collects the code inline; publish-toggle/delete use a step-up
	// confirm dialog. The server re-verifies the code on every write.
	let code = $state('');
	const codeValid = $derived(/^\d{6}$/.test(code));

	let dialogOpen = $state(false);
	let dialogProps = $state<{
		title: string;
		message: string;
		action: string;
		fields: Record<string, string | number | boolean>;
		submitLabel: string;
		danger: boolean;
	}>({ title: '', message: '', action: '', fields: {}, submitLabel: 'Confirm', danger: false });

	function confirmToggle(f: Faq) {
		dialogProps = {
			title: f.isPublished ? 'Unpublish entry' : 'Publish entry',
			message: f.isPublished
				? 'This hides it from the customer Help page. Enter your authenticator code to confirm.'
				: 'This shows it on the customer Help page. Enter your authenticator code to confirm.',
			action: '?/togglePublished',
			fields: { id: f.id, isPublished: (!f.isPublished).toString() },
			submitLabel: f.isPublished ? 'Unpublish' : 'Publish',
			danger: false
		};
		dialogOpen = true;
	}
	function confirmRemove(f: Faq) {
		dialogProps = {
			title: 'Delete FAQ entry',
			message: "This permanently deletes the entry and can't be undone. Enter your authenticator code to confirm.",
			action: '?/remove',
			fields: { id: f.id },
			submitLabel: 'Delete',
			danger: true
		};
		dialogOpen = true;
	}
	// Surface a step-up/validation error inside the dialog only when it belongs to the dialog
	// that's currently open — otherwise a failed `remove` would bleed into a freshly-opened
	// `togglePublished` dialog. `form` is a union of per-action shapes; for this presentation-only
	// check we just need an optional error + action, so read it through a loose view.
	const fv = $derived(form as { ok?: boolean; action?: string; error?: string } | null);
	const dialogError = $derived(
		fv?.error && dialogProps.action === `?/${fv.action}` ? fv.error : null
	);

	type Faq = PageData['faqs'][number];
	type EditState = {
		id: number | null;
		question: string;
		answer: string;
		sortOrder: string;
		isPublished: boolean;
	};

	const blank = (): EditState => ({
		id: null,
		question: '',
		answer: '',
		// Default the new entry to the end of the list.
		sortOrder: String((data.faqs.at(-1)?.sortOrder ?? 0) + 1),
		isPublished: true
	});

	let editing = $state<EditState | null>(null);

	function startNew() {
		code = '';
		editing = blank();
	}
	function startEdit(f: Faq) {
		code = '';
		editing = {
			id: f.id,
			question: f.question,
			answer: f.answer,
			sortOrder: String(f.sortOrder),
			isPublished: f.isPublished
		};
	}

	$effect(() => {
		if (form?.ok && (form.action === 'create' || form.action === 'update')) editing = null;
	});
</script>

<div class="space-y-5">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h2 class="text-base font-semibold text-ink">FAQ</h2>
			<p class="mt-0.5 text-xs text-muted">
				The customer Help page. Only published entries show to guests; order is by the number you
				set.
			</p>
		</div>
		{#if !editing}
			<Button onclick={startNew}>
				<Plus class="h-4 w-4" aria-hidden="true" />
				New entry
			</Button>
		{/if}
	</div>

	{#if fv?.error && (fv.action === 'create' || fv.action === 'update')}
		<p class="rounded-lg bg-blocked/10 px-4 py-3 text-sm text-blocked" role="alert">{fv.error}</p>
	{/if}

	{#if editing}
		<Card>
			<form
				method="post"
				action={editing.id ? '?/update' : '?/create'}
				use:enhance
				class="flex flex-col gap-4"
			>
				<div class="flex items-center justify-between">
					<h3 class="text-sm font-semibold text-ink">{editing.id ? 'Edit entry' : 'New entry'}</h3>
					<button
						type="button"
						onclick={() => (editing = null)}
						class="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-ink"
						aria-label="Cancel"
					>
						<X class="h-4 w-4" />
					</button>
				</div>

				{#if editing.id}<input type="hidden" name="id" value={editing.id} />{/if}

				<label class="flex flex-col gap-1.5 text-xs font-medium text-muted">
					Question
					<input
						name="question"
						bind:value={editing.question}
						required
						placeholder="e.g. How does my time work?"
						class="min-h-[44px] rounded-lg border border-border bg-bg px-3 text-sm text-ink"
					/>
				</label>

				<label class="flex flex-col gap-1.5 text-xs font-medium text-muted">
					Answer
					<textarea
						name="answer"
						bind:value={editing.answer}
						required
						rows="4"
						placeholder="The answer guests will read…"
						class="rounded-lg border border-border bg-bg p-3 text-sm leading-relaxed text-ink"
					></textarea>
				</label>

				<div class="flex flex-wrap items-center gap-6">
					<label class="flex flex-col gap-1.5 text-xs font-medium text-muted">
						Order
						<input
							name="sortOrder"
							type="number"
							step="1"
							bind:value={editing.sortOrder}
							class="min-h-[44px] w-24 rounded-lg border border-border bg-bg px-3 font-mono text-sm text-ink"
						/>
					</label>
					<label class="flex items-center gap-2.5 text-sm text-ink">
						<input
							type="checkbox"
							name="isPublished"
							bind:checked={editing.isPublished}
							class="h-4 w-4"
						/>
						Published — visible to guests
					</label>
				</div>

				<Field
					id="faq-code"
					name="code"
					label="Authenticator code"
					inputmode="numeric"
					autocomplete="one-time-code"
					placeholder="6-digit code"
					value={code}
					oninput={(e) => (code = e.currentTarget.value)}
					class="max-w-40 font-mono tracking-widest"
				/>

				<div class="flex gap-2.5">
					<Button type="submit" disabled={!codeValid}>
						{editing.id ? 'Save changes' : 'Create entry'}
					</Button>
					<Button variant="secondary" onclick={() => (editing = null)}>Cancel</Button>
				</div>
			</form>
		</Card>
	{/if}

	{#if data.faqs.length === 0}
		<p
			class="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted"
		>
			No FAQ entries yet.
		</p>
	{:else}
		<Card class="flex flex-col divide-y divide-border">
			{#each data.faqs as f (f.id)}
				<div class="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
					<span
						class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface font-mono text-xs font-bold text-muted"
						>{f.sortOrder}</span
					>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class="text-sm font-semibold text-ink">{f.question}</span>
							{#if !f.isPublished}
								<span
									class="rounded-full bg-surface px-2 py-0.5 text-[10px] font-bold tracking-wide text-muted uppercase"
									>Draft</span
								>
							{/if}
						</div>
						<p class="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted">{f.answer}</p>
					</div>

					<div class="flex items-center gap-2">
						<button
							type="button"
							onclick={() => confirmToggle(f)}
							class="flex min-h-[44px] items-center rounded-lg border border-border px-3 text-xs font-semibold text-muted hover:text-ink"
						>
							{f.isPublished ? 'Unpublish' : 'Publish'}
						</button>

						<button
							type="button"
							onclick={() => startEdit(f)}
							class="flex h-11 w-11 items-center justify-center rounded-lg border border-border text-muted hover:text-ink"
							aria-label="Edit"
						>
							<Pencil class="h-4 w-4" />
						</button>

						<button
							type="button"
							onclick={() => confirmRemove(f)}
							class="flex h-11 w-11 items-center justify-center rounded-lg border border-border text-blocked hover:bg-blocked/10"
							aria-label="Delete"
						>
							<Trash2 class="h-4 w-4" />
						</button>
					</div>
				</div>
			{/each}
		</Card>
	{/if}

	<StepUpDialog
		bind:open={dialogOpen}
		title={dialogProps.title}
		message={dialogProps.message}
		action={dialogProps.action}
		fields={dialogProps.fields}
		submitLabel={dialogProps.submitLabel}
		danger={dialogProps.danger}
		error={dialogError}
	/>
</div>
