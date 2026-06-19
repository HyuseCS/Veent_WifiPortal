<script lang="ts">
	import type { Component } from 'svelte';
	import type { Kpi } from '$lib/types';
	import { Card } from '$lib/components/ui';

	/**
	 * Headline metric card. `kpi` carries the real value; `icon`, `helper`, and `period`
	 * are presentation-only chrome supplied by the page (honest captions, not data). The
	 * `delta`/`trend` badge renders only when the data actually provides one — no baseline
	 * is fabricated when it's absent.
	 */
	let {
		kpi,
		icon,
		helper,
		period
	}: { kpi: Kpi; icon?: Component; helper?: string; period?: string } = $props();

	const Icon = $derived(icon);
	// Delta is shown as a tinted pill, tone-matched to the trend. Only rendered when the
	// query actually supplies a delta (see comment above) — never invented.
	const deltaPill = $derived(
		kpi.trend === 'down'
			? 'bg-blocked/10 text-blocked'
			: kpi.trend === 'flat'
				? 'bg-surface text-muted'
				: 'bg-online/10 text-online'
	);
</script>

<Card class="group flex flex-col gap-4 hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md">
	<div class="flex items-start justify-between gap-2">
		<p class="text-xs font-semibold tracking-wide text-muted uppercase">{kpi.label}</p>
		{#if Icon}
			<span
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand transition-[background-color,transform,color] duration-200 group-hover:scale-105 group-hover:bg-brand/20"
				aria-hidden="true"
			>
				<Icon class="h-4 w-4" />
			</span>
		{/if}
	</div>

	<div class="flex flex-col gap-2">
		<p class="font-mono text-3xl font-bold tracking-tight text-ink">{kpi.value}</p>
		{#if helper || kpi.delta || period}
			<div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
				<span class="text-xs text-muted">{helper ?? period}</span>
				{#if kpi.delta}
					<span
						class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold {deltaPill}"
					>
						{kpi.delta}
					</span>
				{/if}
			</div>
		{/if}
	</div>
</Card>
