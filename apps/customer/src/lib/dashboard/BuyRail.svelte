<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import Icon from '$lib/Icon.svelte';
	import { resolve } from '$app/paths';
	import { toasts } from '$lib/toasts.svelte';
	import { resetAccountLive } from '$lib/live.svelte';
	import BuySheet from '$lib/dashboard/BuySheet.svelte';

	type Tier = {
		id: number;
		name: string;
		durationMinutes: number | null;
		creditCost: number | null;
		pointsCost: number | null;
	};

	// The buy rail owns the whole buy-undo state machine (nothing outside it needs those). Each
	// tier's row + sheet is a <BuySheet>; the shared `armed`/`buying`/`confirmBuy` flow down so
	// there's ONE countdown across all tiers and the off-radio (#buysheet-none) can abort it.
	let {
		tiers,
		mac,
		hasMac,
		balance,
		points,
		isExpired,
		accessActive,
		handoffUrl
	}: {
		tiers: Tier[];
		mac: string;
		hasMac: boolean;
		balance: number;
		points: number;
		isExpired: boolean;
		accessActive: boolean;
		handoffUrl: string | null;
	} = $props();

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
</script>

<div
	class="flex flex-col lg:max-w-[380px] lg:flex-[0.85] lg:self-center lg:rounded-2xl lg:border lg:border-border lg:bg-bg lg:p-6"
>
	<div class="mb-2.5 text-[11px] font-semibold tracking-wider text-muted uppercase">
		{#if isExpired}Get back online — spend credits{:else if accessActive}Keep going — spend credits{:else}Buy
			access — spend credits{/if}
	</div>
	<section class="mb-6 flex flex-col gap-2.5">
		<!-- Off-state for the buy-sheet radio group: checked = no sheet open. Dismissing any
		sheet (Cancel / backdrop = a `<label for="buysheet-none">`) checks this radio, firing
		`change` — which immediately aborts an armed buy countdown so reopening a tier shows a
		fresh "Confirm" (no stuck "Starting in…"). Handler lives on the radio, not the labels,
		so it stays keyboard-a11y clean. The tier radios live in each <BuySheet> but share this
		group by `name`, so checking this one dismisses whichever sheet is open. -->
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
		{#each tiers as tier (tier.id)}
			<BuySheet {tier} {mac} {hasMac} {balance} {points} {buying} {armed} {confirmBuy} />
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
		<label
			for="signout-confirm"
			class="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-bg text-sm font-semibold text-muted transition-colors hover:cursor-pointer hover:text-ink"
		>
			<Icon name="log-out" size={17} />
			Sign out
		</label>
	</div>

	{#if handoffUrl}
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
			href={handoffUrl}
			rel="noopener"
			class="mt-3 flex min-h-[44px] items-center justify-center gap-1.5 text-center text-[12.5px] font-medium text-muted transition-colors hover:text-ink"
		>
			On the WiFi sign-in screen? Open in your browser to manage credits
			<Icon name="arrow-right" size={15} strokeWidth={2.1} />
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	{/if}
</div>
