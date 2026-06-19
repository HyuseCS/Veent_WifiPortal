<script lang="ts">
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import { enhance } from '$app/forms';
	import { UsersTable } from '$lib/components/feature';
	import { Button } from '$lib/components/ui';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const users = $derived(data.users);

	// Wiping the whole customer base is owner-only and step-up verified: the owner
	// requests a one-time code (emailed to them), then enters it to confirm. The
	// native <dialog> drives the two steps; nothing is destructive until the code
	// is accepted server-side.
	let wipeDialog = $state<HTMLDialogElement>();
	let step = $state<'request' | 'confirm'>('request');
	let code = $state('');

	function openWipe() {
		step = 'request';
		code = '';
		wipeDialog?.showModal();
	}
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between gap-3">
		<p class="text-sm text-muted">{users.length} registered users.</p>
		{#if data.isOwner}
			<Button variant="secondary" class="text-blocked hover:bg-blocked/10" onclick={openWipe}>
				<Trash2 class="h-4 w-4" aria-hidden="true" />
				Wipe user database
			</Button>
		{/if}
	</div>

	<UsersTable {users} />
</div>

{#if data.isOwner}
	<dialog
		bind:this={wipeDialog}
		onclose={() => {
			step = 'request';
			code = '';
		}}
		class="m-auto w-full max-w-sm rounded-lg border border-border bg-bg p-6 text-ink backdrop:bg-black/50"
	>
		<h2 class="text-lg font-semibold text-blocked">Wipe user database</h2>
		<p class="mt-2 text-sm text-muted">
			This permanently deletes <strong>all {users.length} customers</strong> and their sessions, credit
			history, and logins. This cannot be undone.
		</p>

		{#if step === 'request'}
			<!-- Step 1: email the owner a one-time confirmation code. -->
			<form
				method="post"
				action="?/requestWipeCode"
				use:enhance={() =>
					({ update, result }) => {
						if (result.type === 'success') step = 'confirm';
						return update({ reset: false });
					}}
				class="mt-4 space-y-3"
			>
				<p class="text-sm text-muted">
					We'll email a verification code to your admin address. Enter it on the next step to
					confirm.
				</p>
				{#if form?.error}<p class="text-sm text-blocked">{form.error}</p>{/if}
				<div class="flex justify-end gap-2">
					<Button type="button" variant="secondary" onclick={() => wipeDialog?.close()}
						>Cancel</Button
					>
					<Button type="submit">Email me a code</Button>
				</div>
			</form>
		{:else}
			<!-- Step 2: enter the emailed code to execute the wipe. -->
			<form
				method="post"
				action="?/wipe"
				use:enhance={() =>
					({ update, result }) => {
						if (result.type === 'success') wipeDialog?.close();
						return update({ reset: false });
					}}
				class="mt-4 space-y-3"
			>
				<p class="text-sm text-online">Code sent — check your email.</p>
				<label class="block text-sm">
					<span class="text-muted">Verification code</span>
					<input
						name="code"
						bind:value={code}
						inputmode="numeric"
						autocomplete="one-time-code"
						class="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 font-mono tracking-widest text-ink"
					/>
				</label>
				{#if form?.error}<p class="text-sm text-blocked">{form.error}</p>{/if}
				<div class="flex justify-end gap-2">
					<Button type="button" variant="secondary" onclick={() => wipeDialog?.close()}
						>Cancel</Button
					>
					<Button
						type="submit"
						class="bg-blocked text-white hover:bg-blocked/90"
						disabled={!code.trim()}
					>
						Wipe everything
					</Button>
				</div>
			</form>
		{/if}
	</dialog>
{/if}
