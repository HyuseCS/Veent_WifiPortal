<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	let showResentMessage = $state(false);

	const handleResend: SubmitFunction = () => {
		return async ({ update, result }) => {
			// Update runs the default SvelteKit behavior (like invalidating data)
			await update(); 
			
			// Check if the action was successful
			if (result.type === 'success') {
				showResentMessage = true;
				
				setTimeout(() => {
					showResentMessage = false;
				}, 5000);
			}
		};
	}
</script>

<svelte:head>
	<title>Enter code · Veent WiFi</title>
</svelte:head>

<main class="flex min-h-screen items-start justify-center px-5 pt-10 pb-8">
	<div class="w-full max-w-sm space-y-4">
		<h1 class="text-center text-2xl font-bold tracking-tight text-ink">Veent WiFi</h1>

		<div class="rounded-xl border border-border bg-surface p-6 shadow-sm">
			<div class="space-y-1.5">
				<h2 class="text-xl font-semibold text-ink">Enter your code</h2>
				<p class="text-base text-muted">
					We texted a 6-digit code to <span class="font-medium text-ink">{data.maskedPhone}</span>.
				</p>
			</div>

			<form method="post" action="?/verify" use:enhance class="mt-5 space-y-4">
				<div class="space-y-1.5">
					<label for="code" class="block text-sm font-medium text-ink">Verification code</label>
					<input
						id="code"
						name="code"
						type="text"
						inputmode="numeric"
						autocomplete="one-time-code"
						pattern="[0-9]*"
						maxlength="6"
						required
						placeholder="••••••"
						aria-invalid={form?.message ? 'true' : undefined}
						class="min-h-[44px] w-full rounded-lg border border-border bg-bg px-4 py-3 text-center font-mono text-2xl tracking-[0.5em] text-ink transition-colors duration-150 placeholder:tracking-[0.4em] placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
					/>
					{#if form?.message}
						<p class="text-sm text-blocked" role="alert">{form.message}</p>
					{/if}
				</div>

				<button
					type="submit"
					class="min-h-[44px] w-full cursor-pointer rounded-lg bg-cta px-4 py-3 text-sm font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-cta-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta active:scale-[0.98]"
				>
					Verify &amp; connect
				</button>
			</form>

			<div class="mt-4 border-t border-border pt-4">
				{#if showResentMessage}
					<p class="text-sm text-online" role="status">A new code is on its way.</p>
				{:else}
					<form method="post" action="?/resend" use:enhance={handleResend}>
						<button
							type="submit"
							class="min-h-[44px] cursor-pointer text-sm font-medium text-brand hover:text-brand-hover"
						>
							Didn't get it? Resend code
						</button>
					</form>
				{/if}
			</div>
		</div>

		<p class="text-center text-sm text-muted">
			Wrong number?
			<a
				href={data.intent === 'register' ? '/register' : '/login'}
				class="font-semibold text-brand hover:text-brand-hover">Start over</a
			>
		</p>
	</div>
</main>
