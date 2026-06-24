<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button, Field } from '$lib/components/ui';

	// Owner-only, step-up-verified "wipe entire <X> database" dialog, shared by the Users and
	// Networks pages. The flow is identical on both: request a one-time code (emailed to the
	// owner), then enter it to confirm. Both pages expose the SAME form actions
	// (`?/requestWipeCode` + `?/wipe`), so those are hardcoded here; only the wording differs.
	let {
		open = $bindable(false),
		title,
		count,
		noun,
		detail,
		form
	}: {
		/** Bindable: set true to show the modal. */
		open?: boolean;
		/** Heading, e.g. "Wipe user database". */
		title: string;
		/** How many rows will be destroyed (for the warning copy). */
		count: number;
		/** Plural noun for those rows, e.g. "customers" / "access points". */
		noun: string;
		/** What else goes with them, e.g. "their sessions, credit history, and logins". */
		detail: string;
		/** Page `form` for surfacing action errors. */
		form?: { error?: string } | null;
	} = $props();

	let el = $state<HTMLDialogElement>();
	let step = $state<'request' | 'confirm'>('request');
	let code = $state('');

	// Drive the native <dialog> from `open`; reset to step 1 each time it's reopened.
	$effect(() => {
		if (open) {
			step = 'request';
			code = '';
			el?.showModal();
		} else {
			el?.close();
		}
	});
</script>

<dialog
	bind:this={el}
	onclose={() => (open = false)}
	class="m-auto w-full max-w-sm rounded-lg border border-border bg-bg p-6 text-ink backdrop:bg-black/50"
>
	<h2 class="text-lg font-semibold text-blocked">{title}</h2>
	<p class="mt-2 text-sm text-muted">
		This permanently deletes <strong>all {count} {noun}</strong> and {detail}. This cannot be undone.
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
				We'll email a verification code to your admin address. Enter it on the next step to confirm.
			</p>
			{#if form?.error}<p class="text-sm text-blocked">{form.error}</p>{/if}
			<div class="flex justify-end gap-2">
				<Button type="button" variant="secondary" onclick={() => (open = false)}>Cancel</Button>
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
					if (result.type === 'success') open = false;
					return update({ reset: false });
				}}
			class="mt-4 space-y-3"
		>
			<p class="text-sm text-online">Code sent — check your email.</p>
			<Field
				id="wipe-code"
				label="Verification code"
				name="code"
				inputmode="numeric"
				autocomplete="one-time-code"
				value={code}
				oninput={(e) => (code = e.currentTarget.value)}
				class="font-mono tracking-widest"
			/>
			{#if form?.error}<p class="text-sm text-blocked">{form.error}</p>{/if}
			<div class="flex justify-end gap-2">
				<Button type="button" variant="secondary" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" variant="danger-solid" disabled={!code.trim()}>Wipe everything</Button>
			</div>
		</form>
	{/if}
</dialog>
