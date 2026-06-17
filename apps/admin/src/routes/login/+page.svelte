<script lang="ts">
	import { enhance } from '$app/forms';
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
			<div class="space-y-1.5">
				<label for="email" class="block text-sm font-medium text-ink">Email</label>
				<input
					id="email"
					name="email"
					type="email"
					autocomplete="email"
					required
					class="min-h-[44px] w-full rounded-lg border border-border bg-bg px-4 py-3 text-sm text-ink transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
				/>
			</div>

			<div class="space-y-1.5">
				<label for="password" class="block text-sm font-medium text-ink">Password</label>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="current-password"
					required
					class="min-h-[44px] w-full rounded-lg border border-border bg-bg px-4 py-3 text-sm text-ink transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
				/>
			</div>

			{#if form?.message}
				<p class="text-xs text-blocked" role="alert">{form.message}</p>
			{/if}

			<button
				class="min-h-[44px] w-full cursor-pointer rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
			>
				Sign In
			</button>
		</form>

		<p class="text-center text-xs text-muted">Access is restricted to authorized venue staff.</p>
	</div>
</main>
