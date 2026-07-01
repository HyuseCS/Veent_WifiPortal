<script lang="ts">
	import type { Component } from 'svelte';
	import type { Kpi, StatusTone } from '$lib/types';
	import { Card } from '$lib/components/ui';

	/**
	 * Headline metric card shared across Dashboard, Networks, and Finance. `kpi` carries the
	 * real value; `icon`, `helper`, and `period` are presentation-only chrome supplied by the
	 * page (honest captions, not data). `unit` is an optional muted suffix on the value
	 * (e.g. "Mbps", "ms"); `tone`/`captionTone` tint the value and caption to a status colour
	 * (e.g. red Alerts). The `delta`/`trend` badge renders only when the data actually
	 * provides one — no baseline is fabricated when it's absent.
	 */
	let {
		kpi,
		icon,
		helper,
		period,
		unit,
		tone = 'default',
		captionTone = 'muted',
		progress,
		compact = false,
		onclick
	}: {
		kpi: Kpi;
		icon?: Component;
		helper?: string;
		period?: string;
		unit?: string;
		tone?: 'default' | StatusTone;
		captionTone?: 'muted' | StatusTone;
		/** Optional 0–100 fill rendered as a thin brand bar (e.g. a real success/utilisation %). */
		progress?: number;
		/** Denser variant: smaller padding/value/icon so the strip takes less height. */
		compact?: boolean;
		/** When set, the whole card becomes a clickable drill-down (e.g. Networks "Alerts"). */
		onclick?: () => void;
	} = $props();

	const progressPct = $derived(progress === undefined ? 0 : Math.max(0, Math.min(100, progress)));

	const Icon = $derived(icon);
	// Status-tinted value/caption, token-mapped so callers pass semantics, not classes.
	const valueTone: Record<'default' | StatusTone, string> = {
		default: 'text-ink',
		online: 'text-online',
		warning: 'text-warning',
		blocked: 'text-blocked'
	};
	const capTone: Record<'muted' | StatusTone, string> = {
		muted: 'text-muted',
		online: 'text-online',
		warning: 'text-warning',
		blocked: 'text-blocked'
	};
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

<Card
	{onclick}
	padding={compact ? 'p-3 sm:p-3.5' : 'p-3.5 sm:p-5'}
	class="group flex flex-col {compact
		? 'gap-2'
		: 'gap-2 sm:gap-4'} hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md {onclick
		? 'hover:border-brand/40 focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none'
		: ''}"
>
	<div class="flex items-start justify-between gap-2">
		<p class="text-xs font-semibold tracking-wide text-muted uppercase">{kpi.label}</p>
		{#if Icon}
			<span
				class="flex {compact
					? 'h-8 w-8'
					: 'h-9 w-9'} shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand transition-[background-color,transform,color] duration-200 group-hover:scale-105 group-hover:bg-brand/20"
				aria-hidden="true"
			>
				<Icon class="h-4 w-4" />
			</span>
		{/if}
	</div>

	<div class="flex flex-col {compact ? 'gap-1' : 'gap-2'}">
		<p
			class="font-mono {compact
				? 'text-2xl'
				: 'text-2xl sm:text-3xl'} font-bold tracking-tight {valueTone[tone]}"
		>
			{kpi.value}{#if unit}<span class="ml-1 text-sm font-semibold text-muted">{unit}</span>{/if}
		</p>
		{#if helper || kpi.delta || period}
			<div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
				<span class="text-xs {capTone[captionTone]}">{helper ?? period}</span>
				{#if kpi.delta}
					<span
						class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold {deltaPill}"
					>
						{kpi.delta}
					</span>
				{/if}
			</div>
		{/if}
		{#if progress !== undefined}
			<div class="h-1.5 overflow-hidden rounded-full bg-surface" aria-hidden="true">
				<div class="h-full rounded-full bg-brand transition-[width] duration-300" style="width: {progressPct}%"></div>
			</div>
		{/if}
	</div>
</Card>
