<script lang="ts">
	// ⚠️ TEMPORARY dev-only registration UI. Remove with the /register route before prod.
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
			<p class="mt-1 text-sm text-muted">Create an account</p>
		</div>

		<p
			class="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-center text-xs text-warning"
			role="status"
		>
			Temporary registration — for development only. Creates an active owner account.
		</p>

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
			<Field id="name" label="Name" autocomplete="name" required />
			<Field id="email" label="Email" type="email" autocomplete="email" required />
			<Field
				id="password"
				label="Password"
				type="password"
				autocomplete="new-password"
				minlength={8}
				required
			/>

			{#if form?.message}
				<p class="text-xs text-blocked" role="alert">{form.message}</p>
			{/if}

			<Button type="submit" loading={submitting} class="w-full py-2.5">Create Account</Button>
		</form>

		<p class="text-center text-xs text-muted">
			Already have an account? <a href="/login" class="font-medium text-brand hover:underline"
				>Back to sign in</a
			>
		</p>
	</div>
</main>
