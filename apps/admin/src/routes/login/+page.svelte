<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button, Field } from '$lib/components/ui';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<main class="flex min-h-screen items-center justify-center bg-surface px-5 py-10">
	<div class="w-full max-w-sm space-y-6">
		<div class="text-center">
			<span class="text-xl font-semibold tracking-tight text-ink">
				Veent <span class="text-muted">Admin</span>
			</span>
			<p class="mt-1 text-sm text-muted">Staff sign in</p>
		</div>

		<form
			method="post"
			action="?/signInEmail"
			use:enhance
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

			<Button type="submit" class="w-full py-2.5">Sign In</Button>
		</form>

		<p class="text-center text-xs text-muted">Access is restricted to authorized venue staff.</p>
	</div>
</main>
