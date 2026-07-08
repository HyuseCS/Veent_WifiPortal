<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { toasts } from '$lib/toasts.svelte';
	import Icon from '$lib/Icon.svelte';
	import { resetAccountLive } from '$lib/live.svelte';
	import { formatHMS } from '$lib/time';
	import type { AccountView } from '$lib/server/account-view';

	// The ACCOUNT's access window — one countdown shared across all the account's devices
	// (Free Time or a bought tier). The page owns `now`/`paused`/`isExpired` (they feed other
	// derivations too) and passes them in; the band-only display values are derived here.
	let {
		access,
		paused,
		outagePaused,
		isExpired,
		now
	}: {
		access: AccountView['access'];
		paused: boolean;
		outagePaused: boolean;
		isExpired: boolean;
		now: number;
	} = $props();

	const isFree = $derived(access.isFree);
	const activeLabel = $derived(access.label ?? 'Access');
	const activeRemaining = $derived(
		access.expiresAt ? formatHMS(new Date(access.expiresAt).getTime() - now) : ''
	);
	// What the band shows: the frozen hold while paused (static), else the live countdown.
	const displayRemaining = $derived(paused ? formatHMS(access.remainingMs) : activeRemaining);
	const activeEndsAt = $derived(
		access.expiresAt
			? new Date(access.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
			: ''
	);
	const activeProgress = $derived.by(() => {
		if (!access.active || !access.startedAt || !access.expiresAt) return 0;
		const start = new Date(access.startedAt).getTime();
		const total = new Date(access.expiresAt).getTime() - start;
		if (total <= 0) return 100;
		return Math.min(100, Math.max(0, ((now - start) / total) * 100));
	});

	const pauseTime: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'success') toasts.show('Your time is paused and held.');
			else if (result.type === 'failure') toasts.show('Could not pause your time.', 'error');
			await update();
			resetAccountLive();
		};
	};

	const resumeTime: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'success') toasts.show("You're back online — time resumed.");
			else if (result.type === 'failure') toasts.show('Could not resume your time.', 'error');
			await update();
			resetAccountLive();
		};
	};
</script>

{#if isExpired}
	<!-- Ended: timer hit zero locally; re-surface buying another block -->
	<section
		class="mb-6 rounded-2xl border border-border bg-surface p-[17px] lg:mb-0 lg:bg-bg lg:p-7"
	>
		<div class="mb-3.5 flex items-center justify-between lg:mb-6">
			<div class="flex items-center gap-3 lg:gap-3.5">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-xl bg-blocked/[0.13] lg:h-[52px] lg:w-[52px] lg:rounded-2xl"
				>
					<Icon name="clock" size={21} class="text-blocked" />
				</div>
				<div>
					<div class="flex items-center gap-2">
						<span class="text-[15px] font-bold text-ink lg:text-[19px]">{activeLabel}</span>
						<span
							class="rounded-full bg-blocked px-2 py-[3px] text-[10px] font-semibold tracking-wide text-white uppercase"
						>
							Ended
						</span>
					</div>
					<div class="text-xs font-medium text-muted lg:text-[13.5px]">
						Ended at <strong class="text-ink">{activeEndsAt}</strong>
					</div>
				</div>
			</div>
			<div class="text-right">
				<div
					class="font-mono text-[22px] font-semibold tracking-tight text-muted lg:text-[44px] lg:leading-none"
				>
					0:00:00
				</div>
				<div class="text-[10.5px] font-medium tracking-wide text-muted uppercase lg:mt-1.5">
					time's up
				</div>
			</div>
		</div>
		<div class="h-[7px] overflow-hidden rounded-full bg-border lg:h-[9px]"></div>
	</section>
{:else}
	<section
		class="mb-6 rounded-2xl border p-[17px] lg:mb-0 lg:p-7 {paused
			? 'border-warning/30 bg-warning/10'
			: isFree
				? 'border-brand/20 bg-brand-tint-2'
				: 'border-cta/25 bg-cta/10'}"
	>
		<div class="mb-3.5 flex items-center justify-between lg:mb-6">
			<div class="flex items-center gap-3 lg:gap-3.5">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-xl lg:h-[52px] lg:w-[52px] lg:rounded-2xl {paused
						? 'bg-warning'
						: isFree
							? 'bg-brand'
							: 'bg-cta'}"
				>
					<Icon name={paused ? 'pause' : 'clock'} size={21} class="text-white" />
				</div>
				<div>
					<div class="flex items-center gap-2">
						<span class="text-[15px] font-bold text-ink lg:text-[19px]">{activeLabel}</span>
						{#if paused}
							<span
								class="rounded-full bg-warning px-2 py-[3px] text-[10px] font-semibold tracking-wide text-white uppercase"
							>
								{outagePaused ? 'Outage' : 'Paused'}
							</span>
						{:else}
							<span
								class="rounded-full bg-online px-2 py-[3px] text-[10px] font-semibold tracking-wide text-white uppercase"
							>
								Active
							</span>
						{/if}
					</div>
					{#if paused}
						<div class="text-xs font-medium text-warning lg:text-[13.5px]">
							{outagePaused ? 'Network outage — your time is safe' : 'Time held — resume anytime'}
						</div>
					{:else}
						<div class="text-xs font-medium lg:text-[13.5px] {isFree ? 'text-brand' : 'text-cta'}">
							Ends at <strong>{activeEndsAt}</strong> · shared across your devices
						</div>
					{/if}
				</div>
			</div>
			<div class="text-right">
				<div
					class="font-mono text-[22px] font-semibold tracking-tight text-ink lg:text-[44px] lg:leading-none"
				>
					{displayRemaining}
				</div>
				<div class="text-[10.5px] font-medium tracking-wide text-muted uppercase lg:mt-1.5">
					{paused ? 'held' : 'left'}
				</div>
			</div>
		</div>
		{#if !paused}
			<div
				class="h-[7px] overflow-hidden rounded-full lg:h-[9px] {isFree
					? 'bg-brand/15'
					: 'bg-cta/15'}"
			>
				<div
					class="h-full rounded-full {isFree ? 'bg-brand' : 'bg-cta'}"
					style="width:{activeProgress}%"
				></div>
			</div>
		{/if}

		<!-- Pause is paid-only; Free Time can't be paused (it would game the cooldown). -->
		{#if outagePaused}
			<!-- Auto-paused by an outage: no manual Resume — we reconnect automatically when
			     the network is back (resuming into a live outage would just burn held time). -->
			<div
				class="mt-4 flex items-center justify-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-center text-[12.5px] font-medium text-warning"
			>
				<Icon name="clock" size={15} />
				We'll reconnect you automatically when the network is back.
			</div>
		{:else if paused}
			<form method="post" action="?/resumeAccess" use:enhance={resumeTime}>
				<button
					class="mt-4 flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-cta text-[15px] font-bold text-white transition-colors hover:bg-cta-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta hover:cursor-pointer"
				>
					<Icon name="play" size={17} />
					Resume access
				</button>
			</form>
		{:else if !isFree}
			<form method="post" action="?/pauseAccess" use:enhance={pauseTime}>
				<button
					class="mt-4 flex h-[50px] w-full items-center justify-center gap-2 rounded-xl border border-cta/30 bg-surface text-[15px] font-semibold text-cta transition-colors hover:bg-cta/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta hover:cursor-pointer"
				>
					<Icon name="pause" size={17} />
					Pause my time
				</button>
			</form>
		{/if}
	</section>
{/if}
