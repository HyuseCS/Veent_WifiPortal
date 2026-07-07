<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Icon from '$lib/Icon.svelte';
	import { resolve } from '$app/paths';

	// One access tier: the rail row + its confirm/insufficient sheet, revealed via this tier's
	// `peer-checked` radio (CSS only, so it opens before hydration). The buy-undo state machine
	// lives in the parent BuyRail — `armed`/`buying`/`confirmBuy` are passed in so every tier
	// shares ONE countdown and the off-radio can abort it. The tier's peer radio + row + sheet
	// are siblings inside this component's root, so the peer relationship stays intact.
	type Tier = {
		id: number;
		name: string;
		durationMinutes: number | null;
		creditCost: number | null;
		pointsCost: number | null;
	};

	let {
		tier,
		mac,
		hasMac,
		balance,
		points,
		buying,
		armed,
		confirmBuy
	}: {
		tier: Tier;
		mac: string;
		hasMac: boolean;
		balance: number;
		points: number;
		buying: boolean;
		armed: { id: number; left: number } | null;
		confirmBuy: () => SubmitFunction;
	} = $props();

	const ok = $derived(balance >= (tier.creditCost ?? 0));
	// A tier is points-redeemable only if the admin set a pointsCost AND the user can cover it.
	const hasPoints = $derived(tier.pointsCost != null);
	const okP = $derived(tier.pointsCost != null && points >= tier.pointsCost);
	const buyable = $derived(ok || okP);
</script>

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
					<div class="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-brand-tint">
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
					<div class="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-blocked/10">
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
