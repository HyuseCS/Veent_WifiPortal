<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { toasts } from '$lib/toasts.svelte';
	import Icon from '$lib/Icon.svelte';
	import DeviceList from '$lib/DeviceList.svelte';
	import { liveAccount, connectAccountLive, resetAccountLive } from '$lib/live.svelte';
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
	const points = $derived(live?.points ?? data.points);
	const blocked = $derived(live?.blocked ?? data.blocked);
	const freeTime = $derived(live?.freeTime ?? data.freeTime);
	const affordable = (t: Tier) => balance >= (t.creditCost ?? 0);
	// A tier is points-redeemable only if the admin set a pointsCost AND the user can cover it.
	const pointsPriced = (t: Tier) => t.pointsCost != null;
	const affordablePoints = (t: Tier) => t.pointsCost != null && points >= t.pointsCost;

	// Confirm-before-spend is a CSS-only disclosure (a hidden radio per tier + `peer-checked`,
	// see the buy rail below), so the confirm sheet opens the instant "Buy" is tapped — even
	// before hydration. That matters in the captive-portal browser, where a JS-only onclick is
	// dead until the bundle loads. `buysheet-none` is the default-checked off-state.

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
	// Last 3 octets of a MAC — client mirror of $lib/server/account-view's `macTail` (server code
	// can't be imported into the client bundle).
	function macTailOf(m: string | null): string | null {
		if (!m) return null;
		const parts = m.split(':');
		return parts.length >= 3 ? parts.slice(-3).join(':') : m;
	}
	// "Is THIS device bound" — recomputed on the CLIENT from the load-resolved MAC against the
	// (masked) device list, NOT the view's server flag. The SSE stream's `?mac=` is fixed at
	// connect time, so a frame opened before the device was detected reports thisDeviceBound=false
	// forever and overrides the fresh `load` data — that's the "shows connected only after a manual
	// refresh" bug. Matching `data.mac` (re-resolved each load) against the list tails fixes it;
	// falls back to the server flag when we have no MAC at all.
	const myTail = $derived(macTailOf(mac || null));
	const thisDeviceBound = $derived(
		myTail ? devices.list.some((d) => d.macTail === myTail) : devices.thisDeviceBound
	);
	// Paused: the window is frozen and all devices are unbound. `expiresAt` is the FROZEN end
	// (may be in the past), so countdown/expiry logic must ignore it and use the held remaining.
	const paused = $derived(access.paused);
	// Auto-paused by a network outage (vs. the guest tapping Pause). We hold their time and resume
	// automatically when the AP recovers — so we hide the manual Resume (resuming into a live
	// outage would just tick down time they can't use, and the sweep would re-pause them).
	const outagePaused = $derived(paused && access.pausedReason === 'outage');
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
	const needsConnect = $derived(access.active && !paused && hasMac && !thisDeviceBound);
	// The app-bar dot reflects THIS device — account time alone isn't "online" if this
	// device isn't actually bound.
	const thisOnline = $derived(access.active && thisDeviceBound && !isExpired);

	// Per-action pending flags. Each drives its form's `data-pending` binding so the button
	// spinner shows immediately on tap — and, crucially, so Svelte OWNS the attribute after
	// hydration and clears the value the app.html capture-phase listener set on submit
	// (otherwise the inline-script-set data-pending would stick and freeze the spinner).
	let startingFree = $state(false);
	const startFreeTime: SubmitFunction = () => {
		startingFree = true;
		return async ({ result, update }) => {
			if (result.type === 'success') {
				location.reload(); // see confirmBuy — reload so connected state shows immediately
				return;
			}
			await update();
			resetAccountLive();
			startingFree = false;
		};
	};

	let connecting = $state(false);
	const reconnect: SubmitFunction = () => {
		connecting = true;
		return async ({ result, update }) => {
			if (result.type === 'success') {
				location.reload(); // see confirmBuy — reload so connected state shows immediately
				return;
			}
			if (result.type === 'failure') toasts.show('Could not connect this device.', 'error');
			await update();
			resetAccountLive();
			connecting = false;
		};
	};

	let buying = $state(false);

	// Undo window for an accidental Confirm. A user tap NEVER charges — it cancels the POST and arms
	// a short countdown (nothing has hit the server yet). Only when the countdown elapses does the
	// timer set `confirming` and resubmit; that one submission is the sole path that runs the atomic
	// spend+grant. The latch is reliable now that the confirm button isn't disabled during the
	// countdown, so `requestSubmit()` always fires and always consumes the latch. Cancelling or
	// dismissing the sheet aborts with no charge. Pre-hydration the native form posts immediately
	// (enhance inactive) — the CSS-only sheet keeps working, just without the undo nicety.
	const UNDO_SECONDS = 3;
	let armed = $state<{ id: number; left: number } | null>(null);
	let confirming = false; // set true ONLY for the timer's programmatic resubmit
	let armTimer: ReturnType<typeof setInterval> | null = null;
	const clearArmTimer = () => {
		if (armTimer) {
			clearInterval(armTimer);
			armTimer = null;
		}
	};
	const cancelArmed = () => {
		clearArmTimer();
		armed = null;
		confirming = false;
	};
	$effect(() => () => clearArmTimer()); // stop the countdown if the page unmounts mid-window

	const confirmBuy = (): SubmitFunction => {
		return ({ cancel, formElement, formData }) => {
			// The countdown's programmatic resubmit set `confirming` → run the real charge.
			if (confirming) {
				confirming = false;
				armed = null;
				buying = true;
				return async ({ result, update }) => {
					if (result.type === 'success') {
						// Hard reload so the new connected state shows immediately. The in-place `update()`
						// returns correct data (verified) but the live-backed view doesn't reliably
						// re-render it — the page would otherwise look stuck for ~a minute until the SSE
						// pushes. A full reload matches the manual refresh that always works.
						location.reload();
						return;
					}
					if (result.type === 'failure') {
						toasts.show('Could not start that tier. Please try again.', 'error');
					}
					await update();
					resetAccountLive();
					buying = false;
				};
			}
			// User tap → never charge directly. Cancel the POST and (re)arm the undo countdown.
			cancel();
			// The app.html capture-phase script set data-pending='' on this submit (pre-hydration
			// spinner). Arming keeps `buying` false, so Svelte's data-pending binding never changes and
			// won't clear it — leaving the spinner stuck under "Starting in…". Clear it explicitly here.
			formElement.removeAttribute('data-pending');
			const id = Number(formData.get('packageId'));
			if (armed?.id === id) return; // already counting down for this tier — ignore extra taps
			clearArmTimer();
			armed = { id, left: UNDO_SECONDS };
			armTimer = setInterval(() => {
				if (!armed) return clearArmTimer();
				// Dismissing the sheet (Cancel / backdrop) unchecks this tier's radio via CSS AND fires
				// the off-radio's onchange (→ cancelArmed). This is a backstop for the tier-switch case
				// (opening another tier doesn't fire that onchange).
				const sheet = document.getElementById(`buysheet-${armed.id}`) as HTMLInputElement | null;
				if (!sheet?.checked) return cancelArmed();
				if (armed.left <= 1) {
					clearArmTimer();
					confirming = true;
					formElement.requestSubmit(); // → confirming is true → charges via the branch above
				} else {
					armed = { id: armed.id, left: armed.left - 1 };
				}
			}, 1000);
		};
	};

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
				<!-- desktop points pill -->
				<span
					class="hidden items-baseline gap-2 rounded-full bg-white/15 px-[15px] py-2 lg:flex"
					title="Loyalty points — redeemable for access"
				>
					<Icon name="star" size={13} class="text-points self-center" />
					<span class="font-mono text-[15px] font-semibold">{points} pts</span>
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

		<!-- mobile-only large balance block. The "credits"/"points" units already label the
		numbers, so no separate "Balance" caption. Columns bottom-align (items-end). -->
		<div class="flex items-end justify-between gap-2 pr-3 pb-3 pl-4.5 lg:hidden">
			<div class="flex flex-col gap-1">
				<span class="text-[12.5px] font-medium tracking-wider uppercase opacity-80">Hi there,</span>
				<span class="font-mono text-[22px] leading-none font-semibold tracking-tight">
					{data.maskedPhone ?? 'Guest'}
				</span>
			</div>
			<div class="flex flex-col items-end gap-1.5">
				<span class="flex items-center gap-1.5">
					<Icon name="star" size={13} class="text-points" />
					<span class="font-mono text-[15px] font-semibold">{points}</span>
					<span class="text-[13px] font-medium opacity-80">points</span>
				</span>
				<span class="flex items-baseline gap-1.5">
					<span class="font-mono text-[22px] leading-none font-semibold tracking-tight">{balance}</span
					>
					<span class="text-sm font-medium opacity-85">credits</span>
				</span>
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
									<form
										method="post"
										action="?/bindThisDevice"
										use:enhance={reconnect}
										class="group"
										data-pending={connecting ? '' : null}
										data-pending-form
									>
										<input type="hidden" name="mac" value={mac} />
										<button
											disabled={connecting}
											class="flex h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white transition-colors hover:bg-brand-hover hover:cursor-pointer group-data-[pending]:pointer-events-none group-data-[pending]:opacity-70"
										>
											<span
												class="hidden h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white group-data-[pending]:inline-block"
												aria-hidden="true"
											></span>
											<span class="group-data-[pending]:hidden">
												<Icon name="refresh-cw" size={16} />
											</span>
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
												{outagePaused
													? 'Network outage — your time is safe'
													: 'Time held — resume anytime'}
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
							<form
								method="post"
								action="?/startFreeTime"
								use:enhance={startFreeTime}
								class="group"
								data-pending={startingFree ? '' : null}
								data-pending-form
							>
								<input type="hidden" name="mac" value={mac} />
								<button
									disabled={!hasMac || startingFree}
									class="flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-cta text-[15px] font-bold text-white transition-colors hover:bg-cta-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta hover:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 lg:h-14 lg:text-base group-data-[pending]:pointer-events-none group-data-[pending]:opacity-70"
								>
									<span
										class="hidden h-[18px] w-[18px] animate-spin rounded-full border-[2.5px] border-white/40 border-t-white group-data-[pending]:inline-block"
										aria-hidden="true"
									></span>
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
						<!-- Off-state for the buy-sheet radio group: checked = no sheet open. Dismissing any
						sheet (Cancel / backdrop = a `<label for="buysheet-none">`) checks this radio, firing
						`change` — which immediately aborts an armed buy countdown so reopening a tier shows a
						fresh "Confirm" (no stuck "Starting in…"). Handler lives on the radio, not the labels,
						so it stays keyboard-a11y clean. -->
						<input
							type="radio"
							name="buy-sheet"
							id="buysheet-none"
							checked
							onchange={cancelArmed}
							class="sr-only"
							aria-hidden="true"
							tabindex="-1"
						/>
						{#each data.tiers as tier (tier.id)}
							{@const ok = affordable(tier)}
							{@const okP = affordablePoints(tier)}
							{@const hasPoints = pointsPriced(tier)}
							{@const buyable = ok || okP}
							<div>
								<!-- Hidden radio + `peer-checked` reveal this tier's sheet the instant "Buy" is
								tapped — CSS only, so it works before hydration (dead JS onclick in the CNA). -->
								<input type="radio" name="buy-sheet" id="buysheet-{tier.id}" class="peer sr-only" />
								<div
									class="flex items-center justify-between rounded-2xl border border-border py-3 pr-3 pl-4 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand"
								>
									<div>
										<div class="text-[15px] font-semibold text-ink">{tier.name}</div>
										<div class="text-[11.5px] font-medium text-muted">
											{tier.durationMinutes} min · {tier.creditCost} cr{hasPoints
											? ` or ${tier.pointsCost} pts`
											: ''}
										</div>
									</div>
									{#if buyable}
										<label
											for="buysheet-{tier.id}"
											class="flex h-[42px] min-w-[44px] cursor-pointer items-center justify-center rounded-xl bg-brand px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-hover"
										>
											Buy
										</label>
									{:else}
										<label
											for="buysheet-{tier.id}"
											class="flex h-[42px] min-w-[44px] cursor-pointer items-center justify-center rounded-xl border border-border bg-surface px-3.5 text-[13px] font-semibold text-muted"
										>
											Need {tier.creditCost}
										</label>
									{/if}
								</div>

								<!-- Confirm / insufficient sheet for THIS tier. Always in the DOM; shown via the
								tier's `peer-checked`. Bottom sheet on mobile, centered modal on lg. -->
								<div
									role="dialog"
									aria-modal="true"
									aria-label={buyable ? `Start ${tier.name}` : 'Not enough balance'}
									class="pointer-events-none invisible fixed inset-0 z-50 flex items-end justify-center opacity-0 transition-[opacity,visibility] duration-200 peer-checked:pointer-events-auto peer-checked:visible peer-checked:opacity-100 lg:items-center"
								>
									<label
										for="buysheet-none"
										aria-label="Dismiss"
										class="absolute inset-0 cursor-default bg-ink/40"
									></label>
									<div
										class="relative z-10 w-full max-w-sm rounded-t-3xl bg-bg px-5 pt-5 pb-6 shadow-[0_-8px_30px_rgba(0,0,0,0.16)] lg:rounded-3xl lg:p-7"
									>
										<div class="mx-auto mb-[18px] h-1 w-9 rounded bg-border lg:hidden"></div>

										{#if buyable}
											<div class="mb-4 flex items-center gap-3">
												<div
													class="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-brand-tint"
												>
													<Icon name="clock" size={22} class="text-brand" />
												</div>
												<div>
													<div class="text-[17px] font-bold text-ink">
														Start {tier.name} of access?
													</div>
													<div class="text-[12.5px] font-medium text-muted">
														{tier.durationMinutes} minutes, starting now.
													</div>
												</div>
											</div>
											<!-- Pay with credits (primary). Disabled when the credit balance cannot cover it. -->
											<form
												method="post"
												action="?/buyTier"
												use:enhance={confirmBuy()}
												class="group"
												data-pending={buying ? '' : null}
												data-pending-form
											>
												<input type="hidden" name="mac" value={mac} />
												<input type="hidden" name="packageId" value={tier.id} />
												<input type="hidden" name="currency" value="credits" />
												<button
													type="submit"
													disabled={!hasMac || buying || !ok}
													class="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-cta text-base font-bold text-white transition-colors hover:bg-cta-hover hover:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 group-data-[pending]:pointer-events-none group-data-[pending]:opacity-70"
												>
													<span
														class="hidden h-[18px] w-[18px] animate-spin rounded-full border-[2.5px] border-white/40 border-t-white group-data-[pending]:inline-block"
														aria-hidden="true"
													></span>
													{#if armed?.id === tier.id}
														Starting in {armed?.left}…
													{:else if ok}
														Confirm — spend {tier.creditCost} cr
													{:else}
														Need {tier.creditCost} cr
													{/if}
												</button>
											</form>

											{#if hasPoints}
												<!-- Pay with points (secondary). Redeems the loyalty wallet instead of credits. -->
												<form
													method="post"
													action="?/buyTier"
													use:enhance={confirmBuy()}
													class="group mt-2.5"
													data-pending={buying ? '' : null}
													data-pending-form
												>
													<input type="hidden" name="mac" value={mac} />
													<input type="hidden" name="packageId" value={tier.id} />
													<input type="hidden" name="currency" value="points" />
													<button
														disabled={!hasMac || buying || !okP}
														class="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl border border-points/40 bg-points/15 text-base font-bold text-ink transition-colors hover:bg-points/25 hover:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 group-data-[pending]:pointer-events-none group-data-[pending]:opacity-70"
													>
														<Icon name="star" size={17} class="text-points" />
														{okP ? `Redeem ${tier.pointsCost} pts` : `Need ${tier.pointsCost} pts`}
													</button>
												</form>
											{/if}

											<div
												class="mt-3.5 flex items-center justify-center gap-3 text-[12px] font-medium text-muted"
											>
												<span>Balance <span class="font-mono text-ink">{balance} cr</span></span>
												<span aria-hidden="true">·</span>
												<span>Points <span class="font-mono text-ink">{points} pts</span></span>
											</div>
											<label
												for="buysheet-none"
												class="mt-1 flex h-11 w-full cursor-pointer items-center justify-center text-[13px] font-semibold text-muted hover:text-ink"
											>
												{armed?.id === tier.id ? 'Cancel — no charge' : 'Cancel'}
											</label>
										{:else}
											<div class="mb-3 flex items-center gap-3">
												<div
													class="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-blocked/10"
												>
													<Icon name="alert-circle" size={22} class="text-blocked" />
												</div>
												<div>
													<div class="text-[17px] font-bold text-ink">Not enough to buy this</div>
													<div class="text-[12.5px] font-medium text-muted">
														{tier.name} needs {tier.creditCost} credits{hasPoints
															? ` or ${tier.pointsCost} points`
															: ''}.
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
													{(tier.creditCost ?? 0) - balance} cr
												</span>
											</div>
											<a
												href={resolve('/top-up')}
												class="mb-2.5 flex h-[52px] w-full items-center justify-center rounded-xl bg-cta text-base font-bold text-white transition-colors hover:bg-cta-hover"
											>
												Top up credits
											</a>
											<label
												for="buysheet-none"
												class="flex h-11 w-full cursor-pointer items-center justify-center text-[13px] font-semibold text-muted hover:text-ink"
											>
												Not now
											</label>
										{/if}
									</div>
								</div>
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

					{#if data.handoffUrl}
						<!-- Issue 2b/B — CNA→browser handoff. The WiFi sign-in popup (CNA) has its own
						cookie jar, so a session started there doesn't exist in the real browser. This
						link carries a single-use, short-TTL token that mints a session in the system
						browser (see /auth/handoff), so the guest skips a second OTP. Only meaningful
						inside the captive popup; harmless elsewhere, so it's phrased as a hint. -->
						<!-- handoffUrl is an absolute, server-built URL (origin + /auth/handoff + token)
						that must open in the system browser from the captive popup, so resolve() (for
						app-internal relative paths) doesn't apply here. -->
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						<a
							href={data.handoffUrl}
							rel="noopener"
							class="mt-3 flex min-h-[44px] items-center justify-center gap-1.5 text-center text-[12.5px] font-medium text-muted transition-colors hover:text-ink"
						>
							On the WiFi sign-in screen? Open in your browser to manage credits
							<Icon name="arrow-right" size={15} strokeWidth={2.1} />
						</a>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					{/if}
				</div>
			</div>
		{/if}
	</div>

</main>
