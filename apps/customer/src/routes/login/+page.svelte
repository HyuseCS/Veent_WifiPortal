<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>Sign in · Veent WiFi</title>
</svelte:head>

<main class="flex min-h-screen items-start justify-center px-5 pt-10 pb-8">
	<div class="w-full max-w-sm space-y-4">
		<h1 class="text-center text-2xl font-bold tracking-tight text-ink">Veent WiFi</h1>

		<div class="rounded-xl border border-border bg-surface p-6 shadow-sm">
			<div class="space-y-1.5">
				<h2 class="text-xl font-semibold text-ink">Sign in</h2>
				<p class="text-base text-muted">
					Enter your mobile number and we'll text you a one-time code.
				</p>
			</div>

			<form method="post" use:enhance class="mt-5 space-y-4">
				<div class="space-y-1.5">
					<label for="phone" class="block text-sm font-medium text-ink">Phone number</label>
					<input
						id="phone"
						name="phone"
						type="tel"
						inputmode="tel"
						autocomplete="tel"
						required
						value={form?.phone ?? ''}
						placeholder="0917 123 4567"
						aria-invalid={form?.message ? 'true' : undefined}
						class="min-h-[44px] w-full rounded-lg border border-border bg-bg px-4 py-3 text-base text-ink transition-colors duration-150 placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
					/>
					{#if form?.message}
						<p class="text-sm text-blocked" role="alert">{form.message}</p>
					{/if}
				</div>

				<button
					type="submit"
					class="min-h-[44px] w-full cursor-pointer rounded-lg bg-cta px-4 py-3 text-sm font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-cta-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta active:scale-[0.98]"
				>
					Send code
				</button>
			</form>
		</div>

		<p class="text-center text-sm text-muted">
			New here?
			<a href="/register" class="font-semibold text-brand hover:text-brand-hover">
				Create an account
			</a>
		</p>
	</div>
</main>
