<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Icon from '$lib/Icon.svelte';
	import { resolve } from '$app/paths'
	import type { ActionData } from './$types';
	import logo from '$lib/assets/parafiber-logo.webp';

	let { form }: { form: ActionData } = $props();

	// Seed from a failed submit (no-JS fallback) — initial value only; the bound
	// input owns it thereafter, so reading `form` here is deliberately untracked.
	let phone = $state(untrack(() => form?.phone) ?? '');
	let submitting = $state(false);
</script>

<svelte:head>
	<title>Log in · Veent WiFi</title>
</svelte:head>

<main class="mx-auto flex min-h-screen max-w-sm flex-col p-5">
	<div class="-mx-5 -mt-5 mb-7 flex items-center gap-3 bg-brand px-5 py-3">
		<a
			href={resolve('/')}
			aria-label="Back"
			class="flex min-h-8 min-w-8 items-center text-white hover:text-white/80"
		>
			<Icon name="arrow-left" size={20} strokeWidth={2.2} />
		</a>
		<img src={logo} alt="parafiber by parasat logo" class="h-8 w-auto" />
	</div>

	<h1 class="mb-2 text-[25px] font-bold tracking-tight text-ink">Log in to connect</h1>
	<p class="mb-7 text-[14.5px] leading-relaxed text-muted">
		We'll text you a 6-digit code to verify your number.
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
	>
		<label for="phone" class="mb-2 block text-xs font-semibold text-ink">Phone number</label>
		<div
			class="mb-6 flex h-[54px] items-center overflow-hidden rounded-xl border-[1.5px] border-border bg-bg transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15"
		>
			<span
				class="flex h-full items-center border-r border-border bg-surface px-3.5 font-mono text-[15px] font-semibold text-ink"
			>
				+63
			</span>
			<input
				id="phone"
				name="phone"
				type="tel"
				inputmode="numeric"
				autocomplete="tel-national"
				required
				bind:value={phone}
				placeholder="917 654 4521"
				aria-invalid={form?.message ? 'true' : undefined}
				class="h-full flex-1 bg-transparent px-3.5 font-mono text-base text-ink placeholder:text-muted focus:outline-none"
			/>
		</div>

		{#if form?.message}
			<p class="mb-4 text-[13px] font-medium text-blocked" role="alert">{form.message}</p>
		{/if}

		<button
			type="submit"
			disabled={submitting}
			class="flex h-[54px] w-full items-center justify-center gap-2 rounded-xl bg-cta text-base font-bold text-white transition-colors hover:bg-cta-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta disabled:cursor-wait disabled:opacity-80"
		>
			{#if submitting}
				<span
					class="inline-block h-[18px] w-[18px] animate-spin rounded-full border-[2.5px] border-white/40 border-t-white"
					aria-hidden="true"
				></span>
				<span class="sr-only">Sending code…</span>
			{:else}
				Send code
			{/if}
		</button>
	</form>

	<p class="mt-5 text-center text-[12.5px] leading-relaxed text-muted">
		New number? No sign-up needed — we'll set you up automatically.
	</p>
</main>
