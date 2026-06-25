<script lang="ts">
	import TrendingUp from 'lucide-svelte/icons/trending-up';
	import ArrowLeftRight from 'lucide-svelte/icons/arrow-left-right';
	import CircleCheck from 'lucide-svelte/icons/circle-check';
	import Wallet from 'lucide-svelte/icons/wallet';
	import Download from 'lucide-svelte/icons/download';
	import type { Component } from 'svelte';
	import { Card, SectionHeading, FilterTabs } from '$lib/components/ui';
	import { KpiCard, RevenueChart, DonutChart, TransactionsTable } from '$lib/components/feature';
	import type { Kpi } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// lucide types don't match Svelte's `Component` structurally; cast as the other pages do.
	const icon = (c: unknown) => c as Component;

	// Period pills double as SSR navigation — selecting one reloads with `?period=`, which the
	// page load reads. Rendered via the shared <FilterTabs> in link mode so the pill chrome
	// matches the Users/Networks filters.
	const periodTabs = [
		{ key: '7d', label: '7 days' },
		{ key: '30d', label: '30 days' },
		{ key: '90d', label: '90 days' },
		{ key: 'all', label: 'All time' }
	];
	const periodLabel: Record<string, string> = {
		'7d': 'Last 7 days',
		'30d': 'Last 30 days',
		'90d': 'Last 90 days',
		all: 'All time'
	};

	// Presentation chrome for each server KPI — icon + an honest caption describing the metric
	// (not invented data), matched by label so order changes can't mis-pair them. The success
	// rate also drives a real progress bar (its own value, parsed back from "73%").
	// $derived so the period-dependent caption tracks navigation; matched by label so a
	// reordered KPI list can't mis-pair icon/caption to the wrong metric.
	const kpiChrome = $derived<
		Record<string, { icon?: Component; helper: string; progress?: boolean }>
	>({
		'Gross Revenue (settled)': { icon: icon(TrendingUp), helper: periodLabel[data.period] ?? '' },
		Transactions: { icon: icon(ArrowLeftRight), helper: 'settled & failed' },
		'Success Rate': { icon: icon(CircleCheck), helper: 'of all attempts', progress: true },
		'Avg. Transaction': { icon: icon(Wallet), helper: 'per settled payment' }
	});
	const chromeFor = (kpi: Kpi) => kpiChrome[kpi.label] ?? { icon: undefined, helper: '' };

	const revenueTotal = $derived(data.revenue.reduce((sum, p) => sum + p.amount, 0));
	const settledTotal = $derived(data.breakdown.reduce((sum, s) => sum + s.amount, 0));
</script>

<div class="space-y-6">
	<!-- Period selector + export -->
	<div class="flex flex-wrap items-center justify-between gap-3">
		<FilterTabs tabs={periodTabs} active={data.period} href={(key) => `/finance?period=${key}`} />

		<a
			href="/finance/export?period={data.period}"
			download
			class="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-bg px-4 text-sm font-medium text-ink transition-colors hover:bg-surface"
		>
			<Download class="h-4 w-4" aria-hidden="true" />
			Export CSV
		</a>
	</div>

	<!-- KPIs -->
	<section class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
		{#each data.kpis as kpi (kpi.label)}
			{@const c = chromeFor(kpi)}
			<KpiCard
				{kpi}
				icon={c.icon}
				helper={c.helper}
				progress={c.progress ? Number.parseInt(kpi.value, 10) || 0 : undefined}
			/>
		{/each}
	</section>

	<!-- Settled revenue over time -->
	<Card class="flex min-h-65 flex-col">
		<SectionHeading title="Settled revenue over time" class="mb-4">
			{#snippet aside()}
				<span class="font-mono text-sm text-muted">₱{revenueTotal.toLocaleString('en-PH')}</span>
			{/snippet}
		</SectionHeading>
		<div class="min-h-0 flex-1">
			{#if data.revenue.length > 0}
				<RevenueChart data={data.revenue} />
			{:else}
				<p class="grid h-full place-items-center text-sm text-muted">
					No settled revenue in this period.
				</p>
			{/if}
		</div>
	</Card>

	<!-- Breakdowns: settled revenue split by payment method and by access point -->
	<section class="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
		<Card class="flex flex-col">
			<SectionHeading title="By payment method" class="mb-4" />
			<!-- Center the donut block in the leftover height so the card isn't top-heavy. -->
			<div class="flex min-h-0 flex-1 items-center">
				<DonutChart
					data={data.breakdown}
					label="Revenue by payment method"
					centerValue="₱{settledTotal.toLocaleString('en-PH')}"
					centerLabel="Settled"
				/>
			</div>
		</Card>

		<Card class="flex flex-col">
			<SectionHeading title="By access point" class="mb-4" />
			<div class="flex min-h-0 flex-1 items-center">
				<DonutChart
					data={data.apRevenue}
					label="Revenue by access point"
					centerValue="₱{settledTotal.toLocaleString('en-PH')}"
					centerLabel="Settled"
				/>
			</div>
		</Card>
	</section>

	<!-- Transactions -->
	<section class="space-y-2">
		<TransactionsTable transactions={data.transactions} total={data.total} />
		{#if data.total > data.transactions.length}
			<p class="text-xs text-muted">
				{data.total - data.transactions.length} more — narrow the period or export the full CSV.
			</p>
		{/if}
	</section>
</div>
