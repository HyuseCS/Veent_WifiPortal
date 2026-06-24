<script lang="ts">
	import { enhance } from '$app/forms';
	import { fade, fly } from 'svelte/transition';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { toasts } from '$lib/toasts.svelte';
	import Icon from '$lib/Icon.svelte';
	import DeviceList from '$lib/DeviceList.svelte';
	import { liveAccount, connectAccountLive } from '$lib/live.svelte';
	import { resolve } from '$app/paths';
	import type { PageServerData, ActionData } from './$types';
	import logo from '$lib/assets/parafiber-logo.webp';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	type Tier = PageServerData['tiers'][number];

	// The device MAC comes from the captive-portal redirect (`?mac=`), stashed in a
	// cookie by hooks.server.ts. If it's absent the device didn't arrive through the
	// portal (or is bypassed): we surface that instead of sending a fake MAC the
	// router would reject.
	const mac = $derived(data.mac ?? '');
	const hasMac = $derived(!!data.mac);

	// Live per-account view over SSE (pause/resume, purchases, bind/unbind, balance — pushed
	// from ANY of the account's devices). Until the first frame lands, fall back to `load` data.
	$effect(() => connectAccountLive(mac));
	const live = $derived(liveAccount.view);

	const balance = $derived(live?.balance ?? data.balance);
	const blocked = $derived(live?.blocked ?? data.blocked);
	const freeTime = $derived(live?.freeTime ?? data.freeTime);
	const affordable = (t: Tier) => balance >= (t.creditCost ?? 0);

	// Confirm-before-spend (and a soft wall for tiers the guest can't afford yet).
	let sheet = $state<{ kind: 'confirm' | 'insufficient'; tier: Tier } | null>(null);
	const openBuy = (t: Tier) =>
		(sheet = { kind: affordable(t) ? 'confirm' : 'insufficient', tier: t });
	const closeSheet = () => (sheet = null);

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
		freeTime.nextEligibleAt ? new Date(freeTime.nextEligibleAt) : null
	);
	const cooldownClock = $derived(
		nextEligibleAt ? formatHMS(nextEligibleAt.getTime() - now) : '0:00:00'
	);
	const nextFreeTime = $derived(
		nextEligibleAt
			? nextEligibleAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
			: null
	);

	// The ACCOUNT's access window — one countdown shared across all the account's
	// devices (Free Time or a bought tier). Free vs paid only changes the band colour
	// and label; the countdown is shared.
	const access = $derived(live?.access ?? data.access);
	const devices = $derived(live?.devices ?? data.devices);
	// Paused: the window is frozen and all devices are unbound. `expiresAt` is the FROZEN end
	// (may be in the past), so countdown/expiry logic must ignore it and use the held remaining.
	const paused = $derived(access.paused);
	// The server loaded the window as live (expiresAt > now at load). Once the live
	// ticker crosses expiresAt, flip to the "ended" frame locally — the real access
	// cut-off is enforced server-side by the revoke cron, so this is cosmetic. Never while paused.
	const isExpired = $derived(
		access.active && !paused && !!access.expiresAt && now >= new Date(access.expiresAt).getTime()
	);
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

	// This device has live account time but isn't bound (auto-bind hit the cap, or a
	// router hiccup). Surface a connect/replace prompt. Suppressed while paused — the band
	// offers Resume instead, which reconnects the device.
	const needsConnect = $derived(access.active && !paused && hasMac && !devices.thisDeviceBound);
	// The app-bar dot reflects THIS device — account time alone isn't "online" if this
	// device isn't actually bound.
	const thisOnline = $derived(access.active && devices.thisDeviceBound && !isExpired);

	const startFreeTime: SubmitFunction = () => {
		const minutes = freeTime.durationMinutes;
		return async ({ result, update }) => {
			if (result.type === 'success') {
				toasts.show(`You're online — ${minutes} min of free account time, shared across your devices.`);
			}
			await update();
		};
	};

	const reconnect: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'success') toasts.show("You're online on this device.");
			else if (result.type === 'failure') toasts.show('Could not connect this device.', 'error');
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

	const pauseTime: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'success') toasts.show('Your time is paused and held.');
			else if (result.type === 'failure') toasts.show('Could not pause your time.', 'error');
			await update();
		};
	};

	const resumeTime: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'success') toasts.show("You're back online — time resumed.");
			else if (result.type === 'failure') toasts.show('Could not resume your time.', 'error');
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

<main class="flex min-h-screen flex-col lg:bg-surface">
	<!-- App bar / balance header -->
	<header class="bg-brand text-white">
		<div class="flex items-center justify-between px-3 py-3 lg:px-8 lg:py-4">
			<img src={logo} alt="parafiber by parasat logo" class="h-8 w-auto lg:h-[30px]" />
			<div class="flex items-center gap-3 lg:gap-[18px]">
				<!-- live online/offline status (this device) -->
				<span class="flex items-center gap-1.5">
					{#if thisOnline}
						<span class="h-2 w-2 rounded-full bg-online/80"></span>
						<span class="text-xs font-medium opacity-90 lg:text-[13px]">Online</span>
					{:else}
						<span class="h-2 w-2 rounded-full bg-blocked"></span>
						<span class="text-xs font-medium opacity-90 lg:text-[13px]">Offline</span>
					{/if}
				</span>
				<!-- desktop balance pill -->
				<span class="hidden items-baseline gap-2 rounded-full bg-white/15 px-[15px] py-2 lg:flex">
					<span class="text-xs font-medium text-white/80">Balance</span>
					<span class="font-mono text-[15px] font-semibold">{balance} credits</span>
				</span>
				<!-- desktop sign out -->
				<form method="post" action="?/signOut" use:enhance={signOut} class="hidden lg:block">
					<button
						aria-label="Sign out"
						class="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-white/15 text-white/80 transition-colors hover:bg-white/25 hover:text-white hover:cursor-pointer"
					>
						<Icon name="log-out" size={17} />
					</button>
				</form>
			</div>
		</div>

		<!-- mobile-only large balance block -->
		<div class="pr-3 pl-4.5 pb-3 lg:hidden flex flex-col gap-3">
			<div class="flex items-center justify-between">
				<span class="text-[12.5px] font-medium tracking-wider uppercase opacity-80">Hi there,</span>
				<span class="text-[12.5px] font-medium tracking-wider uppercase opacity-80">Balance</span>
			</div>
			<div class="flex items-center justify-between gap-2">
				<span class="font-mono text-[22px] leading-none font-semibold tracking-tight">
					{data.maskedPhone ?? 'Guest'}
				</span>
				<div class="flex items-baseline gap-2">
					<span class="font-mono text-[22px] leading-none font-semibold tracking-tight"
						>{balance}</span
					>
					<span class="text-base font-medium opacity-85">credits</span>
				</div>
			</div>
		</div>
	</header>

	<div class="flex flex-1 flex-col px-5 pt-[18px] pb-5 lg:px-12 lg:py-12">
		{#if form?.error}
			<p class="mb-4 rounded-lg bg-blocked/10 px-4 py-3 text-sm text-blocked" role="alert">
				{form.error}
			</p>
		{/if}

		{#if blocked}
			<p class="rounded-xl bg-blocked/10 px-4 py-3 text-sm text-blocked">
				Your account is blocked. Please contact venue staff.
			</p>
		{:else}
			{#if !hasMac}
				<p class="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800" role="alert">
					Device not detected. Reconnect through the WiFi portal (don't open this page directly) so
					we can get you online.
				</p>
			{/if}

			<!-- Two-pane on desktop: session hero (left) · buy rail (right) -->
			<div
				class="flex flex-1 flex-col lg:mx-auto lg:w-full lg:max-w-6xl lg:flex-row lg:items-stretch lg:gap-10"
			>
				<!-- LEFT: session / Free Time hero -->
				<div class="flex flex-col lg:flex-[1.15] lg:justify-start lg:pt-8">
					<!-- desktop greeting -->
					<div class="mb-[22px] hidden lg:block">
						<div class="mb-1.5 text-[15px] font-medium text-muted">Welcome back,</div>
						<h1 class="text-[28px] font-bold tracking-tight text-ink">
							{data.maskedPhone ?? 'Guest'}
						</h1>
					</div>

					{#if needsConnect}
						<!-- This device has account time but isn't connected (cap or hiccup) -->
						<section
							class="mb-4 rounded-2xl border border-warning/30 bg-warning/[0.12] p-[15px] lg:p-5"
						>
							<div class="flex items-start gap-3">
								<div
									class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warning/20"
								>
									<Icon name="alert-triangle" size={18} class="text-warning" />
								</div>
								<div class="min-w-0 flex-1">
									{#if devices.atCap}
										<div class="text-[14px] font-bold text-ink">Device limit reached</div>
										<div class="mb-3 text-[12.5px] text-muted">
											Your account is on {devices.cap} devices. Connect this one by replacing the device
											you've used least recently{devices.oldest?.macTail
												? ` (··${devices.oldest.macTail})`
												: ''}.
										</div>
									{:else}
										<div class="text-[14px] font-bold text-ink">This device isn't connected</div>
										<div class="mb-3 text-[12.5px] text-muted">
											You have account time left — connect this device to get online.
										</div>
									{/if}
									<form method="post" action="?/bindThisDevice" use:enhance={reconnect}>
										<input type="hidden" name="mac" value={mac} />
										<button
											class="flex h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white transition-colors hover:bg-brand-hover hover:cursor-pointer"
										>
											<Icon name="refresh-cw" size={16} />
											{devices.atCap ? 'Replace oldest device' : 'Connect this device'}
										</button>
									</form>
								</div>
							</div>
						</section>
					{/if}

					<!-- Active access — ACCOUNT remaining-time band (Free Time or paid tier) -->
					{#if access.active && isExpired}
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
											<span class="text-[15px] font-bold text-ink lg:text-[19px]"
												>{activeLabel}</span
											>
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
									<div
										class="text-[10.5px] font-medium tracking-wide text-muted uppercase lg:mt-1.5"
									>
										time's up
									</div>
								</div>
							</div>
							<div class="h-[7px] overflow-hidden rounded-full bg-border lg:h-[9px]"></div>
						</section>
					{:else if access.active}
						{@const isFree = access.isFree}
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
											<span class="text-[15px] font-bold text-ink lg:text-[19px]"
												>{activeLabel}</span
											>
											{#if paused}
												<span
													class="rounded-full bg-warning px-2 py-[3px] text-[10px] font-semibold tracking-wide text-white uppercase"
												>
													Paused
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
												Time held — resume anytime
											</div>
										{:else}
											<div
												class="text-xs font-medium lg:text-[13.5px] {isFree
													? 'text-brand'
													: 'text-cta'}"
											>
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
									<div
										class="text-[10.5px] font-medium tracking-wide text-muted uppercase lg:mt-1.5"
									>
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
							{#if paused}
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
						<!-- Free Time -->
					{:else if freeTime.eligible}
						<section
							class="mb-6 rounded-2xl border border-brand/20 bg-brand-tint-2 p-[17px] lg:mb-0 lg:p-7"
						>
							<div class="mb-3.5 flex items-center gap-3 lg:gap-3.5">
								<div
									class="flex h-10 w-10 items-center justify-center rounded-xl bg-brand lg:h-[52px] lg:w-[52px] lg:rounded-2xl"
								>
									<Icon name="clock" size={21} class="text-white" />
								</div>
								<div>
									<div class="text-[15px] font-bold text-ink lg:text-[19px]">
										Free Time available
									</div>
									<div class="text-xs font-medium text-brand lg:text-[13.5px]">
										{freeTime.durationMinutes} minutes for your whole account · once per 12 hours
									</div>
								</div>
							</div>
							<form method="post" action="?/startFreeTime" use:enhance={startFreeTime}>
								<input type="hidden" name="mac" value={mac} />
								<button
									disabled={!hasMac}
									class="flex h-[50px] w-full items-center justify-center rounded-xl bg-cta text-[15px] font-bold text-white transition-colors hover:bg-cta-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta hover:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 lg:h-14 lg:text-base"
								>
									Start {freeTime.durationMinutes}-min Free Access
								</button>
							</form>
						</section>
					{:else}
						<section
							class="mb-6 rounded-2xl border border-border bg-surface p-[17px] lg:mb-0 lg:bg-bg lg:p-7"
						>
							<div class="mb-3 flex items-center gap-3 lg:gap-3.5">
								<div
									class="flex h-10 w-10 items-center justify-center rounded-xl bg-warning/15 lg:h-[52px] lg:w-[52px] lg:rounded-2xl"
								>
									<Icon name="clock" size={21} class="text-warning" />
								</div>
								<div>
									<div class="text-[15px] font-bold text-ink lg:text-[19px]">
									Free time used (this account)
								</div>
									<div class="text-xs font-medium text-muted lg:text-[13.5px]">
										{#if nextFreeTime}Next session at <strong class="text-ink"
												>{nextFreeTime}</strong
											>{/if}
									</div>
								</div>
							</div>
							<div
								class="flex items-center gap-2 rounded-xl border border-border bg-bg px-3.5 py-2.5 lg:bg-surface"
							>
								<Icon name="clock" size={15} class="text-muted" />
								<span class="text-[12.5px] font-medium text-muted">Available again in</span>
								<span class="ml-auto font-mono text-sm font-semibold text-ink">{cooldownClock}</span
								>
							</div>


						</section>
					{/if}

					<!-- Devices bound under the account window (none while paused). -->
					{#if access.active && !paused}
						<DeviceList {devices} />
					{/if}
				</div>

				<!-- RIGHT: buy rail -->
				<div
					class="flex flex-col lg:max-w-[380px] lg:flex-[0.85] lg:self-center lg:rounded-2xl lg:border lg:border-border lg:bg-bg lg:p-6"
				>
					<div class="mb-2.5 text-[11px] font-semibold tracking-wider text-muted uppercase">
						{#if isExpired}Get back online — spend credits{:else if access.active}Keep going —
							spend credits{:else}Buy access — spend credits{/if}
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
										class="h-[42px] rounded-xl border border-border bg-surface px-3.5 text-[13px] font-semibold text-muted hover:cursor-pointer"
									>
										Need {tier.creditCost}
									</button>
								{/if}
							</div>
						{:else}
							<p class="text-sm text-muted">No access tiers available.</p>
						{/each}
					</section>

					<!-- Desktop: single Top up CTA (sign out lives in the app bar) -->
					<a
						href={resolve('/top-up')}
						class="mt-auto hidden h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-cta text-[15px] font-bold text-white transition-colors hover:bg-cta-hover lg:flex"
					>
						<Icon name="plus" size={17} />
						Top up credits
					</a>

					<!-- Mobile: Top up + Sign out -->
					<div class="mt-auto flex gap-2.5 lg:hidden">
						<a
							href={resolve('/top-up')}
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
				</div>
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
			class="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-sm rounded-t-3xl bg-bg px-5 pt-5 pb-6 shadow-[0_-8px_30px_rgba(0,0,0,0.16)] lg:inset-x-auto lg:top-1/2 lg:right-auto lg:bottom-auto lg:left-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-3xl lg:p-7"
		>
			<div class="mx-auto mb-[18px] h-1 w-9 rounded bg-border lg:hidden"></div>

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
					href={resolve('/top-up')}
					class="mb-2.5 flex h-[52px] w-full items-center justify-center rounded-xl bg-cta text-base font-bold text-white transition-colors hover:bg-cta-hover"
				>
					Top up credits
				</a>
				<button
					type="button"
					onclick={closeSheet}
					class="h-11 w-full text-[13px] font-semibold text-muted hover:text-ink hover:cursor-pointer"
				>
					Not now
				</button>
			{/if}
		</div>
	{/if}
</main>
