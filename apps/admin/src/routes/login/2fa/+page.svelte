<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Button, Field } from '$lib/components/ui';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	// Disable the submit button while the request is in flight (blocks double-submits).
	let submitting = $state(false);
</script>

<main class="flex min-h-screen items-center justify-center bg-surface px-5 py-10">
	<div class="w-full max-w-sm space-y-6">
		<div class="text-center">
			<span class="text-xl font-semibold tracking-tight text-ink">
				RADIUS <span class="text-muted">Admin</span>
			</span>
			<p class="text-xs text-muted">by Parafiber</p>
			<p class="mt-1 text-sm text-muted">Two-factor authentication</p>
		</div>

		<form
			method="post"
			action="?/verify"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
			class="space-y-4 rounded-xl border border-border bg-bg p-6 shadow-sm"
		>
			<p class="text-sm text-muted">
				Enter the 6-digit code from your authenticator app, or one of your backup codes.
			</p>

			<Field
				id="code"
				label="Authentication code"
				inputmode="numeric"
				autocomplete="one-time-code"
				autofocus
				required
				class="font-mono tracking-widest"
			/>

			{#if form?.message}
				<p class="text-xs text-blocked" role="alert">{form.message}</p>
			{/if}

			<Button type="submit" loading={submitting} class="w-full py-2.5">Verify</Button>
		</form>

		<p class="text-center text-xs text-muted">
			<a href={resolve('/login')} class="hover:text-ink">Back to sign in</a>
		</p>
	</div>
</main>
