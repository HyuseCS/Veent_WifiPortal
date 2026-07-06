<script lang="ts">
	import Icon from '$lib/Icon.svelte';
	import { resolve } from '$app/paths';
	import type { PageServerData } from './$types';
	import logo from '$lib/assets/parafiber-logo.webp';

	let { data }: { data: PageServerData } = $props();
</script>

<svelte:head>
	<title>Veent WiFi · Guest access</title>
</svelte:head>

<main class="flex min-h-screen flex-col">
	{#if data.loggedIn}
		<!-- ===== Logged-in: you're good to go ===== -->
		<header class="flex items-center justify-between bg-brand px-5 py-3 lg:px-8 lg:py-4">
			<img src={logo} alt="parafiber by parasat logo" class="h-8 w-auto lg:h-[30px]" />
			<div class="flex items-center gap-1.5">
				<span class="h-1.5 w-1.5 rounded-full bg-online"></span>
				<span class="text-xs font-medium text-white">Online</span>
			</div>
		</header>

		<div class="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
			<div class="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-brand-tint">
				<Icon name="check" size={32} strokeWidth={2.4} class="text-online" />
			</div>
			<h1 class="mb-2 text-2xl font-bold tracking-tight text-ink">You're good to go.</h1>
			<p class="mb-6 max-w-[18rem] text-[15px] leading-relaxed text-muted">
				{#if data.maskedPhone}
					Signed in as <strong class="font-semibold text-ink">{data.maskedPhone}</strong>.
				{/if}
				You're connected to Parafiber WiFi.
			</p>

			<div
				class="mb-7 flex items-center gap-2.5 rounded-xl border border-border bg-surface px-4 py-3"
			>
				<Icon name="clock" size={18} class="text-brand" />
				<span class="text-sm text-muted">Balance</span>
				<span class="font-mono text-base font-bold text-ink">{data.balance} cr</span>
			</div>

			<a
				href="{resolve('/dashboard')}{data.portalQuery}"
				class="flex h-[54px] w-full max-w-sm items-center justify-center gap-2 rounded-xl bg-cta text-base font-bold text-white transition-colors hover:bg-cta-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta"
			>
				Go to dashboard
				<Icon name="arrow-right" size={18} strokeWidth={2.4} />
			</a>
		</div>
	{:else}
		<!-- ===== Logged-out: Free Time hook + view-only pricing ===== -->
		<!-- App bar -->
		<header class="flex items-center justify-between bg-brand px-5 py-3 lg:px-8 lg:py-4">
			<img src={logo} alt="parafiber by parasat logo" class="h-8 w-auto lg:h-[30px]" />
			<div class="flex items-center gap-3 lg:gap-[18px]">
				<span class="text-sm font-medium text-white/80">Guest WiFi</span>
				<a
					href="{resolve('/login')}{data.portalQuery}"
					class="hidden lg:flex h-8 items-center gap-2 rounded-full bg-white/15 px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white lg:h-9"
				>
					<Icon name="lock" size={15} strokeWidth={2.2} />
					Log in
				</a>
			</div>
		</header>

		<!-- Body: single column on mobile, two-pane hero on lg -->
		<div
			class="mx-auto flex w-full max-w-sm flex-1 flex-col px-5 pb-5 lg:max-w-6xl lg:flex-row lg:items-start lg:gap-10 lg:px-12 lg:py-12"
		>
			<!-- LEFT: Free Time hook -->
			<div class="flex flex-col lg:flex-[1.12]">
				<!-- Desktop-only marketing headline -->
				<div class="hidden lg:block">
					<h1 class="mb-3.5 text-[42px] leading-[1.1] font-bold tracking-tight text-ink">
						Fast WiFi,<br />on your terms.
					</h1>
					<p class="mb-7 max-w-[440px] text-base leading-relaxed text-muted">
						Start free, then buy exactly the time you need. No plans, no commitment — money becomes
						credits, credits become time online.
					</p>
				</div>

				<!-- Free Time card -->
				<div
					class="mt-3 rounded-2xl border border-brand/20 bg-brand-tint-2 p-[18px] lg:mt-0 lg:max-w-[460px] lg:p-[22px]"
				>
					<div class="mb-3.5 flex items-center gap-3 lg:mb-[18px]">
						<div
							class="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-brand lg:h-[46px] lg:w-[46px]"
						>
							<Icon name="clock" size={22} class="text-white" />
						</div>
						<div>
							<div class="text-base font-bold text-ink lg:text-lg">Free Time</div>
							<div class="text-[13px] font-medium text-brand">15 min · once every 12 hours</div>
						</div>
					</div>
					<a
						href="{resolve('/login')}{data.portalQuery}"
						class="flex h-[54px] w-full items-center justify-center gap-2 rounded-xl bg-cta text-base font-bold text-white transition-colors hover:bg-cta-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta lg:h-14"
					>
						Connect — get 15 min free
						<Icon name="arrow-right" size={18} strokeWidth={2.4} />
					</a>
					<p class="mt-2.5 text-center text-[11.5px] font-medium text-muted">
						Phone number + SMS code · about 10 seconds
					</p>
				</div>

				<!-- How it works -->
				<div class="pt-3.5 lg:pt-6">
					<div
						class="flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 lg:inline-flex lg:px-[18px] lg:py-3"
					>
						<span class="text-[11.5px] font-semibold text-ink lg:text-[13px]"
							>Money <span class="font-medium text-muted">(₱)</span></span
						>
						<Icon name="chevron-right" size={13} strokeWidth={2.6} class="text-brand" />
						<span class="text-[11.5px] font-semibold text-ink lg:text-[13px]">Credits</span>
						<Icon name="chevron-right" size={13} strokeWidth={2.6} class="text-brand" />
						<span class="text-[11.5px] font-semibold text-ink lg:text-[13px]">Time</span>
					</div>
				</div>
			</div>

			<!-- RIGHT: pricing rail (view only) -->
			<div
				class="mt-4 lg:mt-0 lg:max-w-[400px] lg:flex-[0.88] lg:self-start lg:rounded-2xl lg:border lg:border-border lg:p-6"
			>
				<div class="mb-2.5 flex items-baseline justify-between lg:mb-4">
					<h2 class="text-base font-bold text-ink lg:text-[17px]">What more time costs</h2>
					<span class="text-[11.5px] font-medium text-muted">view only</span>
				</div>

				{#if data.bundles.length > 0}
					<div class="mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">
						Credit bundles
					</div>
					<div class="mb-[18px] overflow-hidden rounded-2xl border border-border lg:mb-5">
						{#each data.bundles as bundle, i (bundle.id)}
							<div
								class="flex items-center justify-between px-[15px] py-3.5 {i < data.bundles.length - 1 ? 'border-b border-border' : ''}"
							>
								<div class="flex items-center gap-2.5">
									<span class="font-mono text-[17px] font-bold text-ink"
										><span class="font-sans">₱</span>{bundle.fiatCost}</span
									>
								</div>
								<div
									class="font-mono text-[13px] font-semibold text-muted"
								>
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

				<!-- Mobile-only footer CTA (desktop logs in via the app-bar pill) -->
				<a
					href="{resolve('/login')}{data.portalQuery}"
					class="mt-6 flex h-[54px] w-full items-center justify-center rounded-xl bg-cta text-base font-bold text-white transition-colors hover:bg-cta-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta lg:hidden"
				>
					Log in to connect
				</a>
				<div class="mt-3 flex items-center justify-center gap-1.5 lg:mt-4 lg:justify-start">
					<Icon name="lock" size={13} class="text-muted" />
					<span class="text-[11.5px] font-medium text-muted">Payments secured by Maya</span>
				</div>
			</div>
		</div>
	{/if}
</main>
