<script lang="ts">
	import { enhance } from '$app/forms';
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
			<p class="mt-1 text-sm text-muted">Reset your password</p>
		</div>

		{#if form?.sent}
			<div
				class="rounded-xl border border-border bg-bg p-6 text-center text-sm text-muted"
				role="status"
			>
				<p class="text-online">Check your inbox.</p>
				<p class="mt-2">
					If an account matches that email, we've sent a link to reset your password. It expires in
					24 hours.
				</p>
			</div>
		{:else}
			<form
				method="post"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update();
						submitting = false;
					};
				}}
				class="space-y-4 rounded-xl border border-border bg-bg p-6 shadow-sm"
			>
				<p class="text-xs text-muted">
					Enter the email on your staff account and we'll send you a reset link.
				</p>

				<Field id="email" label="Email" type="email" autocomplete="email" required />

				{#if form?.message}
					<p class="text-xs text-blocked" role="alert">{form.message}</p>
				{/if}

				<Button type="submit" loading={submitting} class="w-full py-2.5">Send reset link</Button>
			</form>
		{/if}

		<p class="text-center text-xs text-muted">
			<a href="/login" class="underline hover:text-ink">Back to sign in</a>
		</p>
	</div>
</main>
