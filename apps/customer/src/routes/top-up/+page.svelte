<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Icon from '$lib/Icon.svelte';
	import { resolve } from '$app/paths';
	import type { PageServerData, ActionData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	// Credits-per-peso decides the honest "Best value" badge: bigger bundles give
	// a better rate, so the highest ratio wins it. No fake "most popular".
	function bestValueOf(bundles: PageServerData['bundles']): number | null {
		let best: { id: number; rate: number } | null = null;
		for (const b of bundles) {
			const rate = (b.creditsProvided ?? 0) / (b.fiatCost || Infinity);
			if (!best || rate > best.rate) best = { id: b.id, rate };
		}
		return best?.id ?? null;
	}

	const bestValueId = $derived(bestValueOf(data.bundles));

	// The user's explicit choice; null until they tap one. The effective selection
	// falls back to the best-value bundle so a one-tap path to payment always exists.
	let userPick = $state<number | null>(null);
	const selectedId = $derived(userPick ?? bestValueId);

	let pending = $state(false);

	// Selecting a bundle creates a Maya checkout server-side and 303-redirects to
	// the gateway (an external URL). enhance's default would `goto()` that, which
	// only handles internal nav — so we follow the external location ourselves and
	// keep the button in its pending state until the page unloads.
	const checkout: SubmitFunction = () => {
		pending = true;
		return async ({ result, update }) => {
			if (result.type === 'redirect') {
				window.location.href = result.location;
				return;
			}
			pending = false;
			await update();
		};
	};
</script>

<svelte:head>
	<title>Top up · Veent WiFi</title>
</svelte:head>

<main class="flex min-h-screen flex-col p-5 lg:items-center lg:justify-center lg:bg-surface lg:p-8">
	<div
		class="flex w-full flex-1 flex-col lg:max-w-[460px] lg:flex-none lg:rounded-2xl lg:border lg:border-border lg:bg-bg lg:p-7 lg:shadow-sm"
	>
		<a
			href={resolve('/dashboard')}
			class="mb-[22px] flex min-h-[44px] items-center gap-1.5 self-start text-[13px] font-medium text-muted hover:text-ink"
		>
			<Icon name="arrow-left" size={18} strokeWidth={2.2} />
			Dashboard
		</a>

		<div
			class="mb-6 flex items-center justify-between rounded-2xl border border-border bg-surface px-[18px] py-4"
		>
			<span class="text-[13px] font-medium text-muted">Current balance</span>
			<div class="flex items-baseline gap-1.5">
				<span class="font-mono text-2xl font-semibold text-ink">{data.balance}</span>
				<span class="text-[13px] font-medium text-muted">cr</span>
			</div>
		</div>

		{#if form?.error}
			<p class="mb-4 rounded-lg bg-blocked/10 px-4 py-3 text-sm text-blocked" role="alert">
				{form.error}
			</p>
		{/if}

		{#if data.bundles.length === 0}
			<p class="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted">
				No credit bundles are available right now. Please check back soon.
			</p>
		{:else}
			<h1 class="mb-3.5 text-[21px] font-bold tracking-tight text-ink">Choose a bundle</h1>

			<form method="post" action="?/checkout" use:enhance={checkout}>
				<fieldset class="mb-6 flex flex-col gap-2.5" disabled={pending}>
					<legend class="sr-only">Choose a credit bundle</legend>
					{#each data.bundles as bundle (bundle.id)}
						{@const selected = selectedId === bundle.id}
						<label
							class="flex min-h-[44px] cursor-pointer items-center gap-3.5 rounded-xl p-4 transition-colors {selected
								? 'border-2 border-brand bg-brand-tint-2'
								: 'border-[1.5px] border-border bg-bg hover:bg-surface'}"
						>
							<input
								type="radio"
								name="packageId"
								value={bundle.id}
								checked={selected}
								onchange={() => (userPick = bundle.id)}
								class="sr-only"
							/>
							<span
								class="h-5 w-5 shrink-0 rounded-full {selected
									? 'border-[6px] border-brand'
									: 'border-2 border-border'}"
								aria-hidden="true"
							></span>
							<span class="flex flex-1 items-center gap-2">
								<span class="font-mono text-lg font-bold text-ink">₱{bundle.fiatCost}</span>
								{#if bundle.id === bestValueId}
									<span
										class="rounded-full bg-brand px-2 py-[3px] text-[9.5px] font-semibold tracking-wide text-white uppercase"
									>
										Best value
									</span>
								{/if}
							</span>
							<span
								class="font-mono text-[13px] font-semibold {selected ? 'text-brand' : 'text-muted'}"
							>
								{bundle.creditsProvided} credits
							</span>
						</label>
					{/each}
				</fieldset>

				<button
					type="submit"
					disabled={pending || selectedId === null}
					class="flex h-[54px] w-full items-center justify-center gap-2 rounded-xl bg-cta text-base font-bold text-white transition-colors hover:bg-cta-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta disabled:cursor-not-allowed disabled:opacity-50"
				>
					{#if pending}
						<span
							class="inline-block h-[18px] w-[18px] animate-spin rounded-full border-[2.5px] border-white/40 border-t-white"
							aria-hidden="true"
						></span>
						Redirecting to payment…
					{:else}
						Continue to payment
						<Icon name="arrow-right" size={18} strokeWidth={2.4} />
					{/if}
				</button>
			</form>

			{#if pending}
				<p class="mt-3.5 text-center text-[11.5px] font-medium text-muted">
					Taking you to Maya — don't close this window.
				</p>
			{:else}
				<div class="mt-4 flex items-center justify-center gap-1.5">
					<Icon name="lock" size={13} class="text-muted" />
					<span class="text-[11.5px] font-medium text-muted">
						Secured by Maya · credits added after payment
					</span>
				</div>
			{/if}
		{/if}
	</div>
</main>
