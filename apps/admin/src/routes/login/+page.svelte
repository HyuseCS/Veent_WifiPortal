<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { Button, Field } from '$lib/components/ui';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	// Shown after a successful account activation (redirect from /activate).
	const justActivated = $derived(page.url.searchParams.get('activated') === '1');

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
			<p class="mt-1 text-sm text-muted">Staff sign in</p>
		</div>

		{#if justActivated}
			<p
				class="rounded-lg border border-border bg-bg px-4 py-3 text-center text-sm text-online"
				role="status"
			>
				Your account is active. Sign in below.
			</p>
		{/if}

		<form
			method="post"
			action="?/signInEmail"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
			class="space-y-4 rounded-xl border border-border bg-bg p-6 shadow-sm"
		>
			<Field id="email" label="Email" type="email" autocomplete="email" required />
			<Field
				id="password"
				label="Password"
				type="password"
				autocomplete="current-password"
				required
			/>

			{#if form?.message}
				<p class="text-xs text-blocked" role="alert">{form.message}</p>
			{/if}

			<Button type="submit" loading={submitting} class="w-full py-2.5">Sign In</Button>
		</form>

		<p class="text-center text-xs text-muted">
			Staff accounts are created by invitation. Contact the owner for access.
		</p>

		<!-- TEMP: remove with /register -->
		<p class="text-center text-xs text-muted">
			<a href="/register" class="font-medium text-brand hover:underline">Create an account</a>
		</p>
	</div>
</main>
