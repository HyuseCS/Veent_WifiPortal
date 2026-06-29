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
     Desktop (md+) is a full-height one-screen column; mobile flows naturally and scrolls. -->
<div class="flex flex-col gap-6 md:h-full">
	<!-- KPIs -->
	<section class="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
		{#each data.kpis as kpi (kpi.label)}
			{@const c = chromeFor(kpi)}
			<KpiCard
				{kpi}
				icon={c.icon}
				helper={c.helper}
				progress={c.progress ? Number.parseInt(kpi.value, 10) || 0 : undefined}
				compact
			/>
		{/each}
	</section>

	<!-- Revenue + method/access-point breakdowns (transactions list moved to /finance/transactions).
	     On md+, flex-1 + min-h-0 make the cards fill the leftover height down to the page bottom
	     (one screen); on mobile they keep natural height and the page scrolls. Revenue spans 2 of
	     3 columns; the two donuts stack vertically in the 3rd column. -->
	<section class="grid grid-cols-1 gap-4 md:min-h-0 md:flex-1 lg:grid-cols-3 lg:items-stretch">
		<Card class="flex min-h-65 flex-col lg:col-span-2">
			<SectionHeading title="Settled revenue over time" class="mb-4">
				{#snippet aside()}
					<span class="font-mono text-sm text-muted">₱{revenueTotal.toLocaleString('en-PH')}</span>
				{/snippet}
			</SectionHeading>
			<div class="min-h-[200px] flex-1 md:min-h-0">
				{#if data.revenue.length > 0}
					<RevenueChart data={data.revenue} />
				{:else}
					<p class="grid h-full place-items-center text-sm text-muted">
						No settled revenue in this period.
					</p>
				{/if}
			</div>
		</Card>

		<!-- Two donuts. Below lg: a 2-up grid (compact cards) so they sit side-by-side instead of
		     two tall stacked blocks. At lg they return to the stacked 3rd column, sharing its height
		     (one screen, no overflow) — desktop is byte-identical (compact hidden, original shown). -->
		<div class="grid grid-cols-2 gap-4 md:min-h-0 lg:flex lg:flex-col">
			<Card padding="p-3 lg:p-5" class="flex flex-col md:min-h-0 md:flex-1">
				<SectionHeading title="By payment method" class="mb-3 lg:mb-4" />
				<!-- lg: center the donut in the leftover column height (avoids a top-heavy card next to
				     the taller chart). Below lg: plain flow so the donut sits right under the title. -->
				<div class="md:min-h-0 lg:flex lg:flex-1 lg:items-center">
					<div class="w-full lg:hidden">
						<DonutChart
							data={data.breakdown}
							compact
							centerValue="₱{settledTotal.toLocaleString('en-PH')}"
							centerLabel="Settled"
						/>
					</div>
					<div class="hidden w-full lg:block">
						<DonutChart
							data={data.breakdown}
							centerValue="₱{settledTotal.toLocaleString('en-PH')}"
							centerLabel="Settled"
						/>
					</div>
				</div>
			</Card>

			<Card padding="p-3 lg:p-5" class="flex flex-col md:min-h-0 md:flex-1">
				<SectionHeading title="By access point" class="mb-3 lg:mb-4" />
				<div class="md:min-h-0 lg:flex lg:flex-1 lg:items-center">
					<div class="w-full lg:hidden">
						<DonutChart
							data={data.apRevenue}
							label="Revenue by access point"
							compact
							centerValue="₱{settledTotal.toLocaleString('en-PH')}"
							centerLabel="Settled"
						/>
					</div>
					<div class="hidden w-full lg:block">
						<DonutChart
							data={data.apRevenue}
							label="Revenue by access point"
							centerValue="₱{settledTotal.toLocaleString('en-PH')}"
							centerLabel="Settled"
						/>
					</div>
				</div>
			</Card>
		</div>
	</section>
</div>
