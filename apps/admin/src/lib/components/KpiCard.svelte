<script lang="ts">
	import type { Kpi } from '$lib/types';

	let { kpi }: { kpi: Kpi } = $props();

	const trendClass = $derived(
		kpi.trend === 'down' ? 'text-blocked' : kpi.trend === 'flat' ? 'text-muted' : 'text-online'
	);
</script>

<div class="rounded-lg border border-border bg-bg p-5">
	<p class="text-xs font-semibold tracking-wide text-muted uppercase">{kpi.label}</p>
	<p class="mt-1 font-mono text-3xl font-bold text-ink">{kpi.value}</p>
	{#if kpi.delta}
		<p class="mt-1 text-xs {trendClass}">{kpi.delta} vs last week</p>
	{/if}
</div>
