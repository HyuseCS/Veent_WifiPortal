<script lang="ts">
	import { enhance } from '$app/forms';
	import { fade, fly } from 'svelte/transition';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { toasts } from '$lib/toast.svelte';
	import Icon from '$lib/Icon.svelte';
	import type { PageServerData, ActionData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	type Tier = PageServerData['tiers'][number];

	// The device MAC comes from the captive-portal redirect (`?mac=`), stashed in a
	// cookie by hooks.server.ts. If it's absent the device didn't arrive through the
	// portal (or is bypassed): we surface that instead of sending a fake MAC the
	// router would reject.
	const mac = $derived(data.mac ?? '');
	const hasMac = $derived(!!data.mac);

	const balance = $derived(data.balance);
	const affordable = (t: Tier) => balance >= (t.creditCost ?? 0);

	// Confirm-before-spend (and a soft wall for tiers the guest can't afford yet).
	let sheet = $state<{ kind: 'confirm' | 'insufficient'; tier: Tier } | null>(null);
	const openBuy = (t: Tier) =>
		(sheet = { kind: affordable(t) ? 'confirm' : 'insufficient', tier: t });
	const closeSheet = () => (sheet = null);

	// Cheapest tier the guest can already afford — offered inline during cooldown
	// so a spent free session is never a dead end.
	const cheapestAffordable = $derived(
		[...data.tiers]
			.filter(affordable)
			.sort((a, b) => (a.creditCost ?? 0) - (b.creditCost ?? 0))[0] ?? null
	);

	// Live countdown to the next free session.
	let now = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});

	function formatHMS(ms: number): string {
		const s = Math.max(0, Math.floor(ms / 1000));
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
	}

	const nextEligibleAt = $derived(
		data.freeTime.nextEligibleAt ? new Date(data.freeTime.nextEligibleAt) : null
	);
	const cooldownClock = $derived(
		nextEligibleAt ? formatHMS(nextEligibleAt.getTime() - now) : '0:00:00'
	);
	const nextFreeTime = $derived(
		nextEligibleAt
			? nextEligibleAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
			: null
	);

	const startFreeTime: SubmitFunction = () => {
		const minutes = data.freeTime.durationMinutes;
		return async ({ result, update }) => {
			if (result.type === 'success') {
				toasts.show(`You're now connected. Enjoy your free ${minutes} minutes.`);
			}
			await update();
		};
	};

	const confirmBuy = (tier: Tier): SubmitFunction => {
		return () =>
			async ({ result, update }) => {
				if (result.type === 'success') {
					toasts.show(
						`You're now connected with ${tier.name}. Enjoy your ${tier.durationMinutes} minutes.`
					);
					sheet = null;
				} else if (result.type === 'failure') {
					toasts.show('Could not start that tier. Please try again.', 'error');
				}
				await update();
			};
	};

	const signOut: SubmitFunction =
		() =>
		async ({ update }) =>
			update();
</script>

<svelte:head>
	<title>Dashboard · Veent WiFi</title>
</svelte:head>

<main class="mx-auto flex min-h-screen max-w-sm flex-col">
	<!-- Balance header -->
	<header class="bg-brand px-5 pt-6 pb-7 text-white">
		<div class="mb-5 flex items-center justify-between">
			<span class="text-sm font-medium opacity-85">Hi, {data.maskedPhone ?? 'there'}</span>
			<div class="flex items-center gap-1.5">
				<span class="h-1.5 w-1.5 rounded-full bg-online/80"></span>
				<span class="text-xs font-medium opacity-90">Online</span>
			</div>
		</div>
		<div class="mb-1 text-[12.5px] font-medium tracking-wider uppercase opacity-80">Balance</div>
		<div class="flex items-baseline gap-2">
			<span class="font-mono text-[38px] leading-none font-semibold tracking-tight">{balance}</span>
			<span class="text-base font-medium opacity-85">credits</span>
		</div>
	</header>

	<div class="flex flex-1 flex-col px-5 pt-[18px] pb-5">
		{#if form?.error}
			<p class="mb-4 rounded-lg bg-blocked/10 px-4 py-3 text-sm text-blocked" role="alert">
				{form.error}
			</p>
		{/if}

		{#if data.blocked}
			<p class="rounded-xl bg-blocked/10 px-4 py-3 text-sm text-blocked">
				Your account is blocked. Please contact venue staff.
			</p>
		{:else}
		{#if !hasMac}
			<p class="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800" role="alert">
				Device not detected. Reconnect through the WiFi portal (don't open this page
				directly) so we can get you online.
			</p>
		{/if}
			<!-- Free Time -->
			{#if data.freeTime.eligible}
				<section class="mb-6 rounded-2xl border border-brand/20 bg-brand-tint-2 p-[17px]">
					<div class="mb-3.5 flex items-center gap-3">
						<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-brand">
							<Icon name="clock" size={21} class="text-white" />
						</div>
						<div>
							<div class="text-[15px] font-bold text-ink">Free Time available</div>
							<div class="text-xs font-medium text-brand">
								{data.freeTime.durationMinutes} minutes · once per 12 hours
							</div>
						</div>
					</div>
					<form method="post" action="?/startFreeTime" use:enhance={startFreeTime}>
						<input type="hidden" name="mac" value={mac} />
						<button
							disabled={!hasMac}
							class="flex h-[50px] w-full items-center justify-center rounded-xl bg-cta text-[15px] font-bold text-white transition-colors hover:bg-cta-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta hover:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
						>
							Start {data.freeTime.durationMinutes}-min Free Access
						</button>
					</form>
				</section>
			{:else}
				<section class="mb-6 rounded-2xl border border-border bg-surface p-[17px]">
					<div class="mb-3 flex items-center gap-3">
						<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-warning/15">
							<Icon name="clock" size={21} class="text-warning" />
						</div>
						<div>
							<div class="text-[15px] font-bold text-ink">Free time used</div>
							<div class="text-xs font-medium text-muted">
								{#if nextFreeTime}Next session at <strong class="text-ink">{nextFreeTime}</strong
									>{/if}
							</div>
						</div>
					</div>
					<div class="flex items-center gap-2 rounded-xl border border-border bg-bg px-3.5 py-2.5">
						<Icon name="clock" size={15} class="text-muted" />
						<span class="text-[12.5px] font-medium text-muted">Available again in</span>
						<span class="ml-auto font-mono text-sm font-semibold text-ink">{cooldownClock}</span>
					</div>

					{#if cheapestAffordable}
						<div class="mt-3.5 rounded-xl border border-brand/20 bg-brand-tint-2 p-3.5">
							<div class="mb-2.5 text-[12.5px] font-semibold text-ink">
								Can't wait? Get online now
							</div>
							<button
								onclick={() => openBuy(cheapestAffordable)}
								class="flex h-12 w-full items-center justify-between rounded-xl bg-cta px-4 text-white transition-colors hover:bg-cta-hover"
							>
								<span class="text-sm font-bold">Start {cheapestAffordable.name}</span>
								<span class="font-mono text-[13px] opacity-90"
									>{cheapestAffordable.creditCost} cr</span
								>
							</button>
						</div>
					{/if}
				</section>
			{/if}

			<!-- Buy access -->
			<div class="mb-2.5 text-[11px] font-semibold tracking-wider text-muted uppercase">
				Buy access — spend credits
			</div>
			<section class="mb-6 flex flex-col gap-2.5">
				{#each data.tiers as tier (tier.id)}
					{@const ok = affordable(tier)}
					<div
						class="flex items-center justify-between rounded-2xl border border-border py-3 pr-3 pl-4"
					>
						<div>
							<div class="text-[15px] font-semibold text-ink">{tier.name}</div>
							<div class="text-[11.5px] font-medium text-muted">
								{tier.durationMinutes} min · {tier.creditCost} cr
							</div>
						</div>
						{#if ok}
							<button
								onclick={() => openBuy(tier)}
								class="h-[42px] rounded-xl bg-brand px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-hover hover:cursor-pointer"
							>
								Buy
							</button>
						{:else}
							<button
								onclick={() => openBuy(tier)}
								class="h-[42px] rounded-xl border border-border bg-surface px-3.5 text-[13px] font-semibold text-muted"
							>
								Need {tier.creditCost}
							</button>
						{/if}
					</div>
				{:else}
					<p class="text-sm text-muted">No access tiers available.</p>
				{/each}
			</section>

			<!-- Footer actions -->
			<div class="mt-auto flex gap-2.5">
				<a
					href="/top-up"
					class="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface text-sm font-semibold text-brand transition-colors hover:bg-brand-tint-2"
				>
					<Icon name="plus" size={17} />
					Top up
				</a>
				<form method="post" action="?/signOut" use:enhance={signOut} class="flex-1">
					<button
						class="flex h-12 w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-bg text-sm font-semibold text-muted transition-colors hover:text-ink hover:cursor-pointer"
					>
						<Icon name="log-out" size={17} />
						Sign out
					</button>
				</form>
			</div>
		{/if}
	</div>

	<!-- Bottom sheet: confirm spend / insufficient credits -->
	{#if sheet}
		<button
			type="button"
			aria-label="Dismiss"
			onclick={closeSheet}
			transition:fade={{ duration: 150 }}
			class="fixed inset-0 z-40 bg-ink/40"
		></button>
		<div
			transition:fly={{ y: 240, duration: 220 }}
			class="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-sm rounded-t-3xl bg-bg px-5 pt-5 pb-6 shadow-[0_-8px_30px_rgba(0,0,0,0.16)]"
		>
			<div class="mx-auto mb-[18px] h-1 w-9 rounded bg-border"></div>

			{#if sheet.kind === 'confirm'}
				<div class="mb-4 flex items-center gap-3">
					<div class="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-brand-tint">
						<Icon name="clock" size={22} class="text-brand" />
					</div>
					<div>
						<div class="text-[17px] font-bold text-ink">Start {sheet.tier.name} of access?</div>
						<div class="text-[12.5px] font-medium text-muted">
							{sheet.tier.durationMinutes} minutes, starting now.
						</div>
					</div>
				</div>
				<div class="mb-[18px] overflow-hidden rounded-xl border border-border">
					<div class="flex items-center justify-between border-b border-border px-4 py-3">
						<span class="text-[13px] font-medium text-muted">Cost</span>
						<span class="font-mono text-sm font-semibold text-ink">−{sheet.tier.creditCost} cr</span
						>
					</div>
					<div class="flex items-center justify-between px-4 py-3">
						<span class="text-[13px] font-medium text-muted">Balance after</span>
						<span class="font-mono text-sm font-semibold text-brand">
							{balance - (sheet.tier.creditCost ?? 0)} cr
						</span>
					</div>
				</div>
				<form method="post" action="?/buyTier" use:enhance={confirmBuy(sheet.tier)}>
					<input type="hidden" name="mac" value={mac} />
					<input type="hidden" name="packageId" value={sheet.tier.id} />
					<button
						disabled={!hasMac}
						class="mb-2.5 flex h-[52px] w-full items-center justify-center rounded-xl bg-cta text-base font-bold text-white transition-colors hover:bg-cta-hover hover:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
					>
						Confirm — spend {sheet.tier.creditCost} cr
					</button>
				</form>
				<button
					type="button"
					onclick={closeSheet}
					class="h-11 w-full text-[13px] font-semibold text-muted hover:text-ink hover:cursor-pointer"
				>
					Cancel
				</button>
			{:else}
				<div class="mb-3 flex items-center gap-3">
					<div class="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-blocked/10">
						<Icon name="alert-circle" size={22} class="text-blocked" />
					</div>
					<div>
						<div class="text-[17px] font-bold text-ink">Not enough credits</div>
						<div class="text-[12.5px] font-medium text-muted">
							{sheet.tier.name} needs {sheet.tier.creditCost} credits.
						</div>
					</div>
				</div>
				<div
					class="mb-[18px] flex items-center justify-between gap-2 rounded-xl border border-border bg-surface px-4 py-3"
				>
					<span class="text-[13px] font-medium text-muted">You have</span>
					<span class="font-mono text-[15px] font-semibold text-ink">{balance} cr</span>
					<span class="text-[13px] font-medium text-muted">short by</span>
					<span class="font-mono text-[15px] font-semibold text-blocked">
						{(sheet.tier.creditCost ?? 0) - balance} cr
					</span>
				</div>
				<a
					href="/top-up"
					class="mb-2.5 flex h-[52px] w-full items-center justify-center rounded-xl bg-cta text-base font-bold text-white transition-colors hover:bg-cta-hover"
				>
					Top up credits
				</a>
				<button
					type="button"
					onclick={closeSheet}
					class="h-11 w-full text-[13px] font-semibold text-muted hover:text-ink"
				>
					Not now
				</button>
			{/if}
		</div>
	{/if}
</main>
