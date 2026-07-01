<script lang="ts">
	import { Card, SectionHeading } from '$lib/components/ui';
	import { RevenueChart } from '$lib/components/feature';
	import type { SentryVolumePoint } from '$lib/server/sentry/types';

	// 14-day error-volume trend. Reuses <RevenueChart> (same dependency-free SVG) with integer
	// formatters instead of pesos — no chart duplication. `degraded` shows an honest note when
	// the stats fetch failed rather than an empty plot masquerading as "zero errors".
	let { points, degraded = false }: { points: SentryVolumePoint[]; degraded?: boolean } = $props();

	const data = $derived(points.map((p) => ({ label: p.label, amount: p.count })));
	const total = $derived(points.reduce((sum, p) => sum + p.count, 0));

	const fmtCount = (n: number) => n.toLocaleString('en-US');
	// Compact axis ticks: 1.2k / 950 (matches the peso axis' compact intent, sans currency).
	const fmtTick = (n: number) =>
		n >= 1000 ? `${Number((n / 1000).toFixed(1))}k` : String(Math.round(n));
</script>

<Card class="flex min-h-65 flex-1 flex-col md:flex-none">
	<SectionHeading title="Error volume (14 days)" class="mb-4">
		{#snippet aside()}
			<span class="font-mono text-sm text-muted">{total.toLocaleString('en-US')}</span>
		{/snippet}
	</SectionHeading>
	<div class="min-h-[200px] flex-1 md:min-h-0">
		{#if degraded}
			<p class="grid h-full place-items-center text-sm text-muted">
				Couldn't load event volume from Sentry.
			</p>
		{:else if points.length > 0 && total > 0}
			<RevenueChart {data} label="Error volume" formatValue={fmtCount} formatTick={fmtTick} />
		{:else}
			<p class="grid h-full place-items-center text-sm text-muted">
				No errors recorded in the last 14 days.
			</p>
		{/if}
	</div>
</Card>
