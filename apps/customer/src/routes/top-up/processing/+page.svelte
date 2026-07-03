<script lang="ts">
	import { invalidate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Icon from '$lib/Icon.svelte';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	// Bounded poll: re-check the ledger until the verified webhook credits the
	// balance, or give up and show a recoverable failure. This route is the
	// designated "polls DB after payment" waiting room.
	const POLL_MS = 2500;
	const TIMEOUT_MS = 90_000;

	let timedOut = $state(false);
	// Persisted across effect re-runs so each poll doesn't reset the deadline.
	let startedAt = 0;

	const status = $derived(data.settled ? 'success' : timedOut ? 'failed' : 'pending');

	// On settlement, count down out loud, then bounce to the dashboard.
	const REDIRECT_S = 3;
	let secondsLeft = $state(REDIRECT_S);
	$effect(() => {
		if (!data.settled) return;
		secondsLeft = REDIRECT_S;
		const tick = setInterval(() => {
			secondsLeft -= 1;
			if (secondsLeft <= 0) {
				clearInterval(tick);
				goto(resolve('/dashboard') + data.portalQuery);
			}
		}, 1000);
		return () => clearInterval(tick);
	});

	// Poll until settled or timed out.
	$effect(() => {
		if (data.settled || timedOut) return;
		if (startedAt === 0) startedAt = Date.now();
		const poll = setInterval(() => {
			if (Date.now() - startedAt >= TIMEOUT_MS) {
				timedOut = true;
				clearInterval(poll);
			} else {
				invalidate('topup:status');
			}
		}, POLL_MS);
		return () => clearInterval(poll);
	});
</script>

<svelte:head>
	<title>Confirming payment · Veent WiFi</title>
</svelte:head>

<main class="flex min-h-screen flex-col p-5 lg:items-center lg:justify-center lg:bg-surface lg:p-8">
	<div
		class="flex flex-1 flex-col max-w-md self-center lg:flex-none lg:rounded-2xl lg:border lg:border-border lg:bg-bg lg:p-8 lg:shadow-sm"
	>
		<div class="flex flex-1 flex-col items-center justify-center px-1 text-center">
			{#if status === 'pending'}
				<div class="relative mb-7 h-[72px] w-[72px]">
					<span class="absolute inset-0 rounded-full border-4 border-border"></span>
					<span
						class="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-brand"
					></span>
				</div>
				<h1 class="mb-2 text-[22px] leading-tight font-bold tracking-tight text-ink">
					Confirming your payment…
				</h1>
				<p class="mb-7 max-w-[270px] text-sm leading-relaxed text-muted">
					Hang tight — this can take a few seconds on a slow connection. No need to refresh.
				</p>
				{#if data.fiatCost != null}
					<div
						class="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-4 py-3"
					>
						<span class="text-[13px] font-medium text-muted">
							₱{data.fiatCost} · {data.expectedCredits} credits
						</span>
						<span
							class="rounded-full bg-warning/15 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-warning uppercase"
						>
							Pending
						</span>
					</div>
				{/if}
			{:else if status === 'success'}
				<div
					class="mb-6 flex h-[74px] w-[74px] items-center justify-center rounded-full bg-online/15"
				>
					<Icon name="check" size={38} strokeWidth={2.6} class="text-online" />
				</div>
				<h1 class="mb-2 text-[23px] leading-tight font-bold tracking-tight text-ink">
					Payment confirmed
				</h1>
				<p class="mb-6 text-sm leading-relaxed text-muted">
					<strong class="font-semibold text-online">+{data.creditsAdded} credits</strong> added to your
					balance.
				</p>
				<div
					class="mb-7 flex w-full items-center justify-between rounded-2xl border border-border bg-surface px-[18px] py-4"
				>
					<span class="text-[13px] font-medium text-muted">New balance</span>
					<div class="flex items-baseline gap-1.5">
						<span class="font-mono text-[30px] leading-none font-semibold tracking-tight text-ink">
							{data.balance}
						</span>
						<span class="text-sm font-medium text-muted">credits</span>
					</div>
				</div>
				<a
					href="{resolve('/dashboard')}{data.portalQuery}"
					class="flex h-[54px] w-full items-center justify-center gap-2 rounded-xl bg-cta text-base font-bold text-white transition-colors hover:bg-cta-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta"
				>
					Back to dashboard
					<Icon name="arrow-right" size={18} strokeWidth={2.4} />
				</a>
				<p class="mt-3 text-[11.5px] font-medium text-muted">
					Returning automatically in {secondsLeft}s…
				</p>
			{:else}
				<div
					class="mb-6 flex h-[74px] w-[74px] items-center justify-center rounded-full bg-blocked/[0.13]"
				>
					<Icon name="alert-circle" size={36} strokeWidth={2.4} class="text-blocked" />
				</div>
				<h1 class="mb-2 text-[22px] leading-tight font-bold tracking-tight text-ink">
					Still confirming your payment
				</h1>
				<p class="mb-6 max-w-[280px] text-sm leading-relaxed text-muted">
					This is taking longer than usual — no need to pay again. If your payment went through, your
					credits are added automatically once it clears; just check your balance in a few minutes. If
					you were charged and nothing appears, Maya refunds it automatically.
				</p>
				<div
					class="mb-7 flex w-full items-center gap-2.5 rounded-xl border border-blocked/20 bg-blocked/[0.06] px-4 py-3 text-left"
				>
					<Icon name="alert-circle" size={16} class="shrink-0 text-blocked" />
					<span class="text-[12.5px] leading-snug font-medium text-ink">
						Balance unchanged — <span class="font-mono font-semibold">{data.balance} cr</span>
					</span>
				</div>
				<a
					href="{resolve('/top-up')}{data.portalQuery}"
					class="mb-2.5 flex h-[54px] w-full items-center justify-center rounded-xl bg-cta text-base font-bold text-white transition-colors hover:bg-cta-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta"
				>
					Try again
				</a>
				<a
					href="{resolve('/dashboard')}{data.portalQuery}"
					class="flex h-12 w-full items-center justify-center rounded-xl border border-border bg-bg text-sm font-semibold text-muted transition-colors hover:text-ink"
				>
					Back to dashboard
				</a>
			{/if}
		</div>

		{#if status === 'pending'}
			<div class="flex items-center justify-center gap-1.5 pt-6">
				<Icon name="lock" size={13} class="text-muted" />
				<span class="text-[11.5px] font-medium text-muted">
					Secured by Maya · credits added after payment
				</span>
			</div>
		{/if}
	</div>
</main>
