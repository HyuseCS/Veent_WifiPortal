<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button, Field } from '$lib/components/ui';
	import { namesMatch } from '$lib/confirm';

	// Opens a request to demote/remove an OWNER. Owner-only; gated server-side too. The
	// request needs unanimous approval from all other owners before it takes effect (the
	// initiator's submission counts as their approval). Two gates: type the target's name
	// and enter the initiator's own TOTP code.
	let {
		open = $bindable(false),
		member,
		isSelf = false,
		form
	}: {
		open?: boolean;
		/** The owner being targeted. */
		member: { id: string; name: string } | null;
		/** True when the owner is requesting their own demotion/removal. */
		isSelf?: boolean;
		form?: { error?: string; action?: string } | null;
	} = $props();

	let el = $state<HTMLDialogElement>();
	let action = $state<'demote' | 'remove'>('demote');
	let typedName = $state('');
	let code = $state('');

	$effect(() => {
		if (open) {
			action = 'demote';
			typedName = '';
			code = '';
			el?.showModal();
		} else {
			el?.close();
		}
	});

	const canSubmit = $derived(
		!!member && namesMatch(typedName, member.name) && /^\d{6}$/.test(code)
	);
</script>

<dialog
	bind:this={el}
	onclose={() => (open = false)}
	class="m-auto w-full max-w-sm rounded-lg border border-border bg-bg p-6 text-ink backdrop:bg-black/50"
>
	{#if member}
		<h2 class="text-lg font-semibold text-ink">
			{isSelf ? 'Step down as owner' : `Change ${member.name}'s owner role`}
		</h2>
		<p class="mt-2 text-sm text-muted">
			This needs the approval of <strong>every other owner</strong> before it takes effect. Your
			request counts as your approval.
		</p>

		<form
			method="post"
			action="?/requestOwnerChange"
			use:enhance={() =>
				({ update, result }) => {
					if (result.type === 'success') open = false;
					return update({ reset: false });
				}}
			class="mt-4 space-y-3"
		>
			<input type="hidden" name="targetUserId" value={member.id} />

			<fieldset class="space-y-2">
				<legend class="text-sm font-medium text-ink">Action</legend>
				<label class="flex items-center gap-2 text-sm text-ink">
					<input type="radio" name="action" value="demote" bind:group={action} class="accent-blue-600" />
					Demote to admin (keeps the account)
				</label>
				<label class="flex items-center gap-2 text-sm text-ink">
					<input type="radio" name="action" value="remove" bind:group={action} class="accent-blue-600" />
					Remove entirely (deletes the account)
				</label>
			</fieldset>

			<Field
				id="oc-name"
				name="confirmName"
				label="Type {member.name} to confirm"
				autocomplete="off"
				value={typedName}
				oninput={(e) => (typedName = e.currentTarget.value)}
			/>

			<Field
				id="oc-code"
				name="code"
				label="Your authenticator code"
				inputmode="numeric"
				autocomplete="one-time-code"
				value={code}
				oninput={(e) => (code = e.currentTarget.value)}
				class="font-mono tracking-widest"
			/>

			{#if form?.error && form?.action === 'requestOwnerChange'}
				<p class="text-sm text-blocked" role="alert">{form.error}</p>
			{/if}

			<div class="flex justify-end gap-2">
				<Button type="button" variant="secondary" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" variant="danger-solid" disabled={!canSubmit}>Request approval</Button>
			</div>
		</form>
	{/if}
</dialog>
