<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button, Field, BaseDialog } from '$lib/components/ui';

	/**
	 * Confirm-with-TOTP dialog for one-click content writes (activate/publish toggles, delete)
	 * that have no other inputs of their own. Posts `action` with the supplied hidden `fields`
	 * plus the entered `code`; the server re-verifies the code (per-save MFA on /content).
	 * Deliberate multi-field forms (package/FAQ edit, limits save) collect the code inline
	 * instead and don't use this.
	 */
	let {
		open = $bindable(false),
		title,
		message,
		action,
		fields = {},
		submitLabel = 'Confirm',
		danger = false,
		error = null
	}: {
		open?: boolean;
		title: string;
		message: string;
		/** Form action, e.g. '?/toggleActive'. */
		action: string;
		/** Hidden inputs to post alongside the code (id, isActive, …). */
		fields?: Record<string, string | number | boolean>;
		submitLabel?: string;
		danger?: boolean;
		/** Action error to surface (already scoped to this dialog's action by the caller). */
		error?: string | null;
	} = $props();

	let code = $state('');
	const reset = () => (code = '');
	const canSubmit = $derived(/^\d{6}$/.test(code));
</script>

<BaseDialog bind:open {reset}>
	<h2 class="text-lg font-semibold text-ink">{title}</h2>
	<p class="mt-2 text-sm text-muted">{message}</p>

	<form
		method="post"
		{action}
		use:enhance={() =>
			({ update, result }) => {
				if (result.type === 'success') open = false;
				return update({ reset: false });
			}}
		class="mt-4 space-y-3"
	>
		{#each Object.entries(fields) as [key, value] (key)}
			<input type="hidden" name={key} value={String(value)} />
		{/each}

		<Field
			id="stepup-code"
			name="code"
			label="Authenticator code"
			inputmode="numeric"
			autocomplete="one-time-code"
			placeholder="6-digit code"
			value={code}
			oninput={(e) => (code = e.currentTarget.value)}
			class="font-mono tracking-widest"
		/>

		{#if error}
			<p class="text-sm text-blocked" role="alert">{error}</p>
		{/if}

		<div class="flex justify-end gap-2">
			<Button type="button" variant="secondary" onclick={() => (open = false)}>Cancel</Button>
			<Button type="submit" variant={danger ? 'danger-solid' : 'primary'} disabled={!canSubmit}>
				{submitLabel}
			</Button>
		</div>
	</form>
</BaseDialog>
