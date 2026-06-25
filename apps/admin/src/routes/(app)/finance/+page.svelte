<script lang="ts">
	import TrendingUp from 'lucide-svelte/icons/trending-up';
	import ArrowLeftRight from 'lucide-svelte/icons/arrow-left-right';
	import CircleCheck from 'lucide-svelte/icons/circle-check';
	import Wallet from 'lucide-svelte/icons/wallet';
	import type { Component } from 'svelte';
	import { Card, SectionHeading } from '$lib/components/ui';
	import { KpiCard, RevenueChart, DonutChart } from '$lib/components/feature';
	import type { Kpi } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// lucide types don't match Svelte's `Component` structurally; cast as the other pages do.
	const icon = (c: unknown) => c as Component;

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

<!-- Period selector + Export CSV now live in the Topbar header (FinanceHeaderControls).
     Full-height column so the charts stretch to the bottom of the page. -->
<div class="flex h-full flex-col gap-6">
	<!-- KPIs -->
	<section class="grid shrink-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

	<!-- Revenue + method/access-point breakdowns (transactions list moved to /finance/transactions).
	     flex-1 + min-h-0 so the cards fill the leftover height down to the page bottom. Revenue
	     spans 2 of 4 columns; the two donuts take one each. -->
	<section class="grid min-h-0 flex-1 grid-cols-1 items-stretch gap-4 lg:grid-cols-4">
		<Card class="flex min-h-65 flex-col lg:col-span-2">
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

		<Card class="flex flex-col">
			<SectionHeading title="By payment method" class="mb-4" />
			<!-- Center the donut block in the leftover height so the card isn't top-heavy
			     next to the taller chart panel. -->
			<div class="flex min-h-0 flex-1 items-center">
				<DonutChart
					data={data.breakdown}
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
</div>
