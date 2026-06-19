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
	const trendClass = $derived(
		kpi.trend === 'down' ? 'text-blocked' : kpi.trend === 'flat' ? 'text-muted' : 'text-online'
	);
</script>

<Card class="flex flex-col gap-3">
	<div class="flex items-start justify-between gap-2">
		<p class="text-xs font-semibold tracking-wide text-muted uppercase">{kpi.label}</p>
		{#if Icon}
			<span
				class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand"
				aria-hidden="true"
			>
				<Icon class="h-4 w-4" />
			</span>
		{/if}
	</div>

	<div>
		<p class="font-mono text-3xl font-bold tracking-tight text-ink">{kpi.value}</p>
		<div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
			{#if helper}
				<span class="text-xs text-muted">{helper}</span>
			{/if}
			{#if kpi.delta}
				<span class="text-xs font-medium {trendClass}">{kpi.delta}</span>
			{/if}
		</div>
	</div>

	{#if period}
		<p
			class="mt-auto inline-flex w-fit rounded-full bg-surface px-2 py-0.5 text-[10px] font-medium tracking-wide text-muted uppercase"
		>
			{period}
		</p>
	{/if}
</Card>
