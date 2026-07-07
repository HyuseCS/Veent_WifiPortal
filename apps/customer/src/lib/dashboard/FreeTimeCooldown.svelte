<script lang="ts">
	import Icon from '$lib/Icon.svelte';
	import { formatHMS } from '$lib/time';
	import type { AccountView } from '$lib/server/account-view';

	// Free time already used this window — show the live countdown to the next session.
	// The page owns the `now` ticker and passes it in so the clock ticks each second.
	let { freeTime, now }: { freeTime: AccountView['freeTime']; now: number } = $props();

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
</script>

<section class="mb-6 rounded-2xl border border-border bg-surface p-[17px] lg:mb-0 lg:bg-bg lg:p-7">
	<div class="mb-3 flex items-center gap-3 lg:gap-3.5">
		<div
			class="flex h-10 w-10 items-center justify-center rounded-xl bg-warning/15 lg:h-[52px] lg:w-[52px] lg:rounded-2xl"
		>
			<Icon name="clock" size={21} class="text-warning" />
		</div>
		<div>
			<div class="text-[15px] font-bold text-ink lg:text-[19px]">Free time used (this account)</div>
			<div class="text-xs font-medium text-muted lg:text-[13.5px]">
				{#if nextFreeTime}Next session at <strong class="text-ink">{nextFreeTime}</strong>{/if}
			</div>
		</div>
	</div>
	<div
		class="flex items-center gap-2 rounded-xl border border-border bg-bg px-3.5 py-2.5 lg:bg-surface"
	>
		<Icon name="clock" size={15} class="text-muted" />
		<span class="text-[12.5px] font-medium text-muted">Available again in</span>
		<span class="ml-auto font-mono text-sm font-semibold text-ink">{cooldownClock}</span>
	</div>
</section>
