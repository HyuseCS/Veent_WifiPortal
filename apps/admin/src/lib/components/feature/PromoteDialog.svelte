<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button, Field, BaseDialog } from '$lib/components/ui';
	import { namesMatch } from '$lib/confirm';

	// Owner-only step-up confirmation for promoting an admin to owner. Two gates the owner
	// must clear together: type the target's name, and re-enter their own TOTP code. The
	// server (?/promote) re-enforces BOTH — this dialog is the UX, not the security boundary.
	let {
		open = $bindable(false),
		member,
		form
	}: {
		/** Bindable: set true to show the modal. */
		open?: boolean;
		/** The admin being promoted. */
		member: { id: string; name: string } | null;
		/** Page `form` for surfacing the action error (tagged action === 'promote'). */
		form?: { error?: string; action?: string } | null;
	} = $props();

	let typedName = $state('');
	let code = $state('');

	// Clear the inputs each time the dialog reopens (BaseDialog calls this on open).
	const reset = () => {
		typedName = '';
		code = '';
	};

	// Both gates must pass before the confirm button enables (server re-checks both).
	const canSubmit = $derived(!!member && namesMatch(typedName, member.name) && /^\d{6}$/.test(code));
</script>

<BaseDialog bind:open {reset}>
	{#if member}
		<h2 class="text-lg font-semibold text-ink">Promote to owner</h2>
		<p class="mt-2 text-sm text-muted">
			This grants <strong>{member.name}</strong> full owner control — including managing staff and
			destructive actions. There is no self-serve way to undo it.
		</p>

		<form
			method="post"
			action="?/promote"
			use:enhance={() =>
				({ update, result }) => {
					if (result.type === 'success') open = false;
					return update({ reset: false });
				}}
			class="mt-4 space-y-3"
		>
			<input type="hidden" name="userId" value={member.id} />

			<Field
				id="promote-name"
				name="confirmName"
				label="Type {member.name} to confirm"
				autocomplete="off"
				value={typedName}
				oninput={(e) => (typedName = e.currentTarget.value)}
			/>

			<Field
				id="promote-code"
				name="code"
				label="Your authenticator code"
				inputmode="numeric"
				autocomplete="one-time-code"
				value={code}
				oninput={(e) => (code = e.currentTarget.value)}
				class="font-mono tracking-widest"
			/>

			{#if form?.error && form?.action === 'promote'}
				<p class="text-sm text-blocked" role="alert">{form.error}</p>
			{/if}

			<div class="flex justify-end gap-2">
				<Button type="button" variant="secondary" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" variant="danger-solid" disabled={!canSubmit}>Promote to owner</Button>
			</div>
		</form>
	{/if}
</BaseDialog>
