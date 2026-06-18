<script lang="ts">
	import Icon from '$lib/Icon.svelte';
	import { resolve } from '$app/paths';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	// Credits-per-peso decides the honest "Best value" badge — biggest bundle wins.
	const bestBundleId = $derived.by(() => {
		let best: { id: number; rate: number } | null = null;
		for (const b of data.bundles) {
			const rate = (b.creditsProvided ?? 0) / (b.fiatCost || Infinity);
			if (!best || rate > best.rate) best = { id: b.id, rate };
		}
		return best?.id ?? null;
	});
</script>

<svelte:head>
	<title>Veent WiFi · Guest access</title>
</svelte:head>

<main class="mx-auto flex min-h-screen max-w-sm flex-col">
	{#if data.loggedIn}
		<!-- ===== Logged-in: you're good to go ===== -->
		<div class="flex items-center justify-between px-5 py-4">
			<div class="flex items-center gap-2">
				<Icon name="wifi" size={21} strokeWidth={2.2} class="text-brand" />
				<span class="text-lg font-bold tracking-tight text-ink">veent</span>
			</div>
			<div class="flex items-center gap-1.5">
				<span class="h-1.5 w-1.5 rounded-full bg-online"></span>
				<span class="text-xs font-medium text-online">Online</span>
			</div>
		</div>

		<div class="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
			<div class="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-brand-tint">
				<Icon name="check" size={32} strokeWidth={2.4} class="text-online" />
			</div>
			<h1 class="mb-2 text-2xl font-bold tracking-tight text-ink">You're good to go.</h1>
			<p class="mb-6 max-w-[18rem] text-[15px] leading-relaxed text-muted">
				{#if data.maskedPhone}
					Signed in as <strong class="font-semibold text-ink">{data.maskedPhone}</strong>.
				{/if}
				You're connected to Veent WiFi.
			</p>

			<div
				class="mb-7 flex items-center gap-2.5 rounded-xl border border-border bg-surface px-4 py-3"
			>
				<Icon name="clock" size={18} class="text-brand" />
				<span class="text-sm text-muted">Balance</span>
				<span class="font-mono text-base font-bold text-ink">{data.balance} cr</span>
			</div>

			<a
				href={resolve('/dashboard')}
				class="flex h-[54px] w-full items-center justify-center gap-2 rounded-xl bg-cta text-base font-bold text-white transition-colors hover:bg-cta-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta"
			>
				Go to dashboard
				<Icon name="arrow-right" size={18} strokeWidth={2.4} />
			</a>
		</div>
	{:else}
		<!-- ===== Logged-out: Free Time hook + view-only pricing ===== -->
		<div class="flex items-center justify-between px-5 py-4">
			<div class="flex items-center gap-2">
				<Icon name="wifi" size={21} strokeWidth={2.2} class="text-brand" />
				<span class="text-lg font-bold tracking-tight text-ink">veent</span>
			</div>
			<span class="text-xs font-medium text-muted">Guest WiFi</span>
		</div>

		<!-- Free Time hook -->
		<div class="mx-5 mt-3 rounded-2xl border border-brand/20 bg-brand-tint-2 p-[18px]">
			<div class="mb-3.5 flex items-center gap-3">
				<div class="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-brand">
					<Icon name="clock" size={22} class="text-white" />
				</div>
				<div>
					<div class="text-base font-bold text-ink">Free Time</div>
					<div class="text-[13px] font-medium text-brand">15 min · once every 12 hours</div>
				</div>
			</div>
			<a
				href={resolve('/login')}
				class="flex h-[54px] w-full items-center justify-center gap-2 rounded-xl bg-cta text-base font-bold text-white transition-colors hover:bg-cta-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta"
			>
				Connect — get 15 min free
				<Icon name="arrow-right" size={18} strokeWidth={2.4} />
			</a>
			<p class="mt-2.5 text-center text-[11.5px] font-medium text-muted">
				Phone number + SMS code · about 10 seconds
			</p>
		</div>

		<!-- How it works -->
		<div class="px-5 pt-3.5">
			<div
				class="flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5"
			>
				<span class="text-[11.5px] font-semibold text-ink"
					>Money <span class="font-medium text-muted">(₱)</span></span
				>
				<Icon name="chevron-right" size={13} strokeWidth={2.6} class="text-brand" />
				<span class="text-[11.5px] font-semibold text-ink">Credits</span>
				<Icon name="chevron-right" size={13} strokeWidth={2.6} class="text-brand" />
				<span class="text-[11.5px] font-semibold text-ink">Time</span>
			</div>
		</div>

		<!-- Pricing (view only) -->
		<div class="px-5 pt-4">
			<div class="mb-2.5 flex items-baseline justify-between">
				<h2 class="text-base font-bold text-ink">What more time costs</h2>
				<span class="text-[11.5px] font-medium text-muted">view only</span>
			</div>

			{#if data.bundles.length > 0}
				<div class="mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">
					Credit bundles
				</div>
				<div class="mb-[18px] overflow-hidden rounded-2xl border border-border">
					{#each data.bundles as bundle, i (bundle.id)}
						{@const best = bundle.id === bestBundleId}
						<div
							class="flex items-center justify-between px-[15px] py-3.5 {best
								? 'border-l-[3px] border-brand bg-brand-tint-2'
								: ''} {i < data.bundles.length - 1 ? 'border-b border-border' : ''}"
						>
							<div class="flex items-center gap-2.5">
								<span class="font-mono text-[17px] font-bold text-ink">₱{bundle.fiatCost}</span>
								{#if best}
									<span
										class="rounded-full bg-brand px-2 py-[3px] text-[10px] font-semibold tracking-wide text-white uppercase"
									>
										Best value
									</span>
								{/if}
							</div>
							<div class="font-mono text-[13px] font-semibold {best ? 'text-brand' : 'text-muted'}">
								{bundle.creditsProvided} credits
							</div>
						</div>
					{/each}
				</div>
			{/if}

			{#if data.tiers.length > 0}
				<div class="mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">
					Access tiers — spend credits
				</div>
				<div class="flex flex-col gap-2">
					{#each data.tiers as tier (tier.id)}
						<div
							class="flex items-center justify-between rounded-xl border border-border px-[15px] py-3"
						>
							<div>
								<div class="text-[15px] font-semibold text-ink">{tier.name}</div>
								<div class="text-[11.5px] font-medium text-muted">
									{tier.durationMinutes} minutes
								</div>
							</div>
							<div class="font-mono text-sm font-semibold text-brand">{tier.creditCost} cr</div>
						</div>
					{/each}
				</div>
				<p class="mt-3 text-[11.5px] leading-relaxed text-muted">
					Spend credits on a block of time. Free Time needs no credits.
				</p>
			{/if}
		</div>

		<!-- Footer CTA -->
		<div class="mt-auto p-5 pt-6">
			<a
				href={resolve('/login')}
				class="flex h-[54px] w-full items-center justify-center rounded-xl bg-cta text-base font-bold text-white transition-colors hover:bg-cta-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta"
			>
				Log in to connect
			</a>
			<div class="mt-3 flex items-center justify-center gap-1.5">
				<Icon name="lock" size={13} class="text-muted" />
				<span class="text-[11.5px] font-medium text-muted">Payments secured by Maya</span>
			</div>
		</div>
	{/if}
</main>
