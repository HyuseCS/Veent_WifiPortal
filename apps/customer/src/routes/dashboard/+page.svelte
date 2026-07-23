<script lang="ts">
	import DeviceList from '$lib/DeviceList.svelte';
	import SocialLinks from '$lib/SocialLinks.svelte';
	import DashboardHeader from '$lib/dashboard/DashboardHeader.svelte';
	import NeedsConnectCard from '$lib/dashboard/NeedsConnectCard.svelte';
	import AccessBand from '$lib/dashboard/AccessBand.svelte';
	import FreeTimeCard from '$lib/dashboard/FreeTimeCard.svelte';
	import FreeTimeCooldown from '$lib/dashboard/FreeTimeCooldown.svelte';
	import BuyRail from '$lib/dashboard/BuyRail.svelte';
	import SignOutDialog from '$lib/dashboard/SignOutDialog.svelte';
	import { liveAccount, connectAccountLive } from '$lib/live.svelte';
	import { macTailOf } from '$lib/time';
	import type { PageServerData, ActionData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

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

	// Live 1s ticker, shared by the access band (countdown) and the free-time cooldown clock.
	let now = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});

	// The ACCOUNT's access window — one countdown shared across all the account's
	// devices (Free Time or a bought tier). Free vs paid only changes the band colour
	// and label; the countdown is shared.
	const access = $derived(live?.access ?? data.access);
	const devices = $derived(live?.devices ?? data.devices);
	// "Is THIS device bound" — recomputed on the CLIENT from the load-resolved MAC against the
	// (masked) device list, NOT the view's server flag. The SSE stream's `?mac=` is fixed at
	// connect time, so a frame opened before the device was detected reports thisDeviceBound=false
	// forever and overrides the fresh `load` data — that's the "shows connected only after a manual
	// refresh" bug. Matching `data.mac` (re-resolved each load) against the list tails fixes it;
	// falls back to the server flag when we have no MAC at all.
	// `deviceVerified` = the load resolved THIS device's MAC from a LIVE detector (portal cookie /
	// router IP→MAC), not a fallback guess. Absent on SSE-only frames → default true (SSE carries a
	// connect-time MAC, treated as verified — documented known-gap). When false, a MAC-tail match must
	// NOT assert "bound": the fallback MAC may be stale/wrong, so a match would falsely claim connected
	// and trap the user in a loop a refresh can't clear (AC2).
	const deviceVerified = $derived(data.deviceVerified ?? true);
	const myTail = $derived(macTailOf(mac || null));
	// Does this device's (masked) MAC match a bound device in the list? Recomputed on the CLIENT so a
	// stale SSE frame (thisDeviceBound fixed at connect) can't override fresh load data.
	const matchesBound = $derived(
		myTail ? devices.list.some((d) => d.macTail === myTail) : devices.thisDeviceBound
	);
	// Only a VERIFIED match counts as bound. An unverified match is surfaced as "unverified" so the UI
	// offers a reconnect recovery path instead of claiming the device is online.
	const thisDeviceBound = $derived(deviceVerified ? matchesBound : false);
	const thisDeviceUnverified = $derived(!deviceVerified && matchesBound);
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

	// This device has live account time but isn't bound (auto-bind hit the cap, or a
	// router hiccup). Surface a connect/replace prompt. Suppressed while paused — the band
	// offers Resume instead, which reconnects the device.
	const needsConnect = $derived(
		access.active && !paused && hasMac && !thisDeviceBound && !thisDeviceUnverified
	);
	// The app-bar dot reflects THIS device — account time alone isn't "online" if this
	// device isn't actually bound.
	const thisOnline = $derived(access.active && thisDeviceBound && !isExpired);
</script>

<svelte:head>
	<title>Dashboard · Parafiber WiFi</title>
</svelte:head>

<main class="flex min-h-screen flex-col lg:bg-surface">
	<DashboardHeader {thisOnline} {balance} {points} maskedPhone={data.maskedPhone ?? null} />

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
			{:else if access.active && thisDeviceUnverified}
				<p class="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800" role="alert">
					We couldn't verify this device is connected. Reconnect through the WiFi portal to get back
					online.
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
						<NeedsConnectCard {devices} {mac} />
					{/if}

					<!-- Active access — ACCOUNT remaining-time band (Free Time or paid tier), else
					Free Time available, else the cooldown to the next free session. -->
					{#if access.active}
						<AccessBand {access} {paused} {outagePaused} {isExpired} {now} />
					{:else if freeTime.eligible}
						<FreeTimeCard durationMinutes={freeTime.durationMinutes} {mac} {hasMac} />
					{:else}
						<FreeTimeCooldown {freeTime} {now} />
					{/if}

					<!-- Devices bound under the account window (none while paused). -->
					{#if access.active && !paused}
						<DeviceList {devices} />
					{/if}
				</div>

				<!-- RIGHT: buy rail — tier list, confirm/undo sheets, top-up + handoff. Owns its own
				buy-undo state; the mobile Sign out label targets the page's #signout-confirm by id. -->
				<BuyRail
					tiers={data.tiers}
					{mac}
					{hasMac}
					{balance}
					{points}
					{isExpired}
					accessActive={access.active}
					handoffUrl={data.handoffUrl ?? null}
				/>
			</div>
		{/if}
	</div>

	<SocialLinks />

	<!-- Sign-out confirmation. CSS-only (peer-checked) like the buy sheet, so it works before
	hydration; the actual POST /signOut form lives inside SignOutDialog and still submits without
	JS. Both the app-bar and mobile Sign out controls are <label for="signout-confirm"> that toggle
	this checkbox — SignOutDialog's root is its peer sibling. -->
	<input type="checkbox" id="signout-confirm" class="peer sr-only" />
	<SignOutDialog />
</main>
