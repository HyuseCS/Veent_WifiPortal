<script lang="ts">
	import UserPlus from 'lucide-svelte/icons/user-plus';
	import Plus from 'lucide-svelte/icons/plus';
	import X from 'lucide-svelte/icons/x';
	import type { Component } from 'svelte';
	import { enhance } from '$app/forms';
	import { Button, IconButton } from '$lib/components/ui';

	// Shared input styling, matching <Field>'s input (rows here use placeholders + aria-labels
	// instead of per-row visible labels, so the repeater stays compact and aligned).
	const inputClass =
		'min-h-11 w-full rounded-lg border border-border bg-bg px-4 py-3 text-sm text-ink transition-[border-color,box-shadow] duration-150 hover:border-brand/40 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none';

	// Owner-only mass-invite modal. Each row is a (name, email) pair posted as repeated `name`
	// / `email` fields; the server (`?/invite`) pairs them by index and invites each, reporting
	// per-row success/failure. Opened from the "Add staff" button in the Members table toolbar
	// (bindable `open`). Stays open after a batch so the owner sees the outcome.
	let { open = $bindable(false) }: { open?: boolean } = $props();

	// Keep batches under the per-actor email cap (20/hr); mirrors MAX_INVITES on the server.
	const MAX_ROWS = 10;

	let error = $state('');
	let sent = $state<string[]>([]);
	let failed = $state<{ email: string; error: string }[]>([]);
	let submitting = $state(false);
	let el = $state<HTMLDialogElement>();

	// Rows are tracked by stable id so a keyed {#each} preserves each uncontrolled input's typed
	// value across add/remove (no need to mirror field values in state). `nextId` only ever grows.
	let nextId = 1;
	let rows = $state<number[]>([0]);

	function addRow() {
		if (rows.length < MAX_ROWS) rows = [...rows, nextId++];
	}
	function removeRow(id: number) {
		if (rows.length > 1) rows = rows.filter((r) => r !== id);
	}
	function reset() {
		rows = [0];
		nextId = 1;
		error = '';
		sent = [];
		failed = [];
	}

	$effect(() => {
		if (open) el?.showModal();
		else el?.close();
	});
</script>

<dialog
	bind:this={el}
	onclose={() => {
		open = false;
		reset();
	}}
	class="m-auto w-full max-w-lg rounded-lg border border-border bg-bg p-6 text-ink backdrop:bg-black/50"
>
	<div class="flex items-center gap-3">
		<span
			class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand"
			aria-hidden="true"
		>
			<UserPlus class="h-5 w-5" />
		</span>
		<div class="min-w-0">
			<h2 class="font-semibold text-ink">Add staff members</h2>
			<p class="text-xs text-muted">Invite one or more admins by email</p>
		</div>
	</div>

	<form
		class="mt-4 space-y-4"
		method="post"
		action="?/invite"
		use:enhance={() => {
			submitting = true;
			return async ({ result, update }) => {
				const data = result.type === 'success' || result.type === 'failure' ? result.data : undefined;
				const d = data as
					| { error?: string; sent?: string[]; failed?: { email: string; error: string }[] }
					| undefined;
				if (result.type === 'success') {
					sent = d?.sent ?? [];
					failed = d?.failed ?? [];
					error = '';
					await update({ reset: false });
					// Clear the row inputs so the owner can start a fresh batch (success stays shown).
					reset();
					sent = d?.sent ?? [];
					failed = d?.failed ?? [];
				} else if (result.type === 'failure') {
					error = d?.error ?? 'Could not send invitations.';
					sent = d?.sent ?? [];
					failed = d?.failed ?? [];
					await update({ reset: false });
				} else {
					await update();
				}
				submitting = false;
			};
		}}
	>
		<div class="space-y-2">
			{#each rows as id, i (id)}
				<div class="flex items-center gap-2">
					<div class="grid flex-1 gap-2 sm:grid-cols-2">
						<input
							name="name"
							placeholder="Full name"
							aria-label="Full name for invitee {i + 1}"
							autocomplete="off"
							class={inputClass}
						/>
						<input
							name="email"
							type="email"
							placeholder="email@example.com"
							aria-label="Email for invitee {i + 1}"
							autocomplete="off"
							class={inputClass}
						/>
					</div>
					<IconButton
						icon={X as unknown as Component}
						label="Remove invitee {i + 1}"
						tone="danger"
						disabled={rows.length === 1}
						onclick={() => removeRow(id)}
					/>
				</div>
			{/each}
		</div>

		<button
			type="button"
			onclick={addRow}
			disabled={rows.length >= MAX_ROWS}
			class="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
		>
			<Plus class="h-4 w-4" aria-hidden="true" />
			Add another
		</button>

		<p class="text-xs text-muted">
			We'll email an activation link to each address. Members set their own password and activate
			before they can sign in. Up to {MAX_ROWS} at a time.
		</p>

		{#if error}
			<p class="animate-fade-in-up text-sm text-blocked" role="alert">{error}</p>
		{/if}
		{#if sent.length > 0}
			<p class="animate-fade-in-up text-sm text-online" role="status">
				Sent {sent.length} invitation{sent.length === 1 ? '' : 's'}: {sent.join(', ')}.
			</p>
		{/if}
		{#if failed.length > 0}
			<ul class="animate-fade-in-up space-y-1 text-sm text-blocked">
				{#each failed as f (f.email)}
					<li><span class="font-mono">{f.email}</span> — {f.error}</li>
				{/each}
			</ul>
		{/if}

		<div class="flex justify-end gap-2">
			<Button type="button" variant="secondary" onclick={() => (open = false)}>Close</Button>
			<Button type="submit" loading={submitting}>
				Send {rows.length > 1 ? `${rows.length} invitations` : 'invitation'}
			</Button>
		</div>
	</form>
</dialog>
