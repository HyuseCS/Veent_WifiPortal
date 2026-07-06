<script lang="ts">
	import TrendingUp from 'lucide-svelte/icons/trending-up';
	import ArrowLeftRight from 'lucide-svelte/icons/arrow-left-right';
	import CircleCheck from 'lucide-svelte/icons/circle-check';
	import Wallet from 'lucide-svelte/icons/wallet';
	import type { Component } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { Card, SectionHeading } from '$lib/components/ui';
	import { KpiCard, RevenueChart, DonutChart } from '$lib/components/feature';
	import type { Kpi } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The heavy aggregates stream from the load (see +page.server.ts). Resolve them into local
	// state; reset to null while a new promise is in flight (initial load AND period switches,
	// which return a fresh promise) so the skeleton shows instead of stale numbers. The identity
	// guard drops a stale resolve if the period changed again before this one landed.
	type Snapshot = Awaited<PageData['snapshot']>;
	let snapshot = $state<Snapshot | null>(null);
	let loadError = $state(false);
	$effect(() => {
		const p = data.snapshot;
		snapshot = null;
		loadError = false;
		// Handle BOTH settle paths: a streamed-promise rejection is delivered to the client but does
		// NOT hit +error.svelte (the load already returned), so without this a query error would leave
		// the skeleton up forever. The identity guard drops a stale settle if the period changed again.
		p.then(
			(s) => {
				if (data.snapshot === p) snapshot = s;
			},
			() => {
				if (data.snapshot === p) loadError = true;
			}
		);
	});

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

	const revenueTotal = $derived((snapshot?.revenue ?? []).reduce((sum, p) => sum + p.amount, 0));
	const settledTotal = $derived((snapshot?.breakdown ?? []).reduce((sum, s) => sum + s.amount, 0));
</script>

{#snippet skelCard()}
	<div class="flex flex-col gap-3 rounded-xl border border-border bg-bg p-4 shadow-sm">
		<div class="h-3 w-20 rounded bg-surface"></div>
		<div class="h-6 w-16 rounded bg-surface"></div>
		<div class="h-3 w-24 rounded bg-surface"></div>
	</div>
{/snippet}

{#if loadError}
	<div class="grid h-full min-h-[50vh] place-items-center">
		<div class="max-w-sm rounded-xl border border-border bg-bg p-6 text-center shadow-sm">
			<p class="text-sm text-muted">Couldn't load finance data for this period.</p>
			<button
				type="button"
				onclick={() => invalidateAll()}
				class="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
			>
				Try again
			</button>
		</div>
	</div>
{:else if !snapshot}
	<!-- Skeleton silhouette mirroring KPIs · revenue chart · two donuts, so the initial load and
	     period switches paint instantly while the aggregates stream in (no layout shift on resolve). -->
	<div class="flex animate-pulse flex-col gap-6 md:h-full" aria-hidden="true">
		<section class="grid shrink-0 grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
			{#each Array.from({ length: 4 }, (_, i) => i) as i (i)}{@render skelCard()}{/each}
		</section>
		<section class="grid grid-cols-1 gap-4 md:min-h-0 md:flex-1 lg:grid-cols-3">
			<div class="min-h-65 rounded-xl border border-border bg-bg shadow-sm lg:col-span-2"></div>
			<div class="grid grid-cols-2 gap-4 lg:flex lg:flex-col">
				<div class="min-h-48 rounded-xl border border-border bg-bg shadow-sm lg:flex-1"></div>
				<div class="min-h-48 rounded-xl border border-border bg-bg shadow-sm lg:flex-1"></div>
			</div>
		</section>
	</div>
{:else}
<!-- Period selector + Export CSV now live in the Topbar header (FinanceHeaderControls).
     Desktop (md+) is a full-height one-screen column; mobile flows naturally and scrolls. -->
<div class="flex flex-col gap-6 md:h-full">
	<!-- KPIs -->
	<section class="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
		{#each snapshot.kpis as kpi (kpi.label)}
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
				{#if snapshot.revenue.length > 0}
					<RevenueChart data={snapshot.revenue} />
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
							data={snapshot.breakdown}
							compact
							centerValue="₱{settledTotal.toLocaleString('en-PH')}"
							centerLabel="Settled"
						/>
					</div>
					<div class="hidden w-full lg:block">
						<DonutChart
							data={snapshot.breakdown}
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
							data={snapshot.apRevenue}
							label="Revenue by access point"
							compact
							centerValue="₱{settledTotal.toLocaleString('en-PH')}"
							centerLabel="Settled"
						/>
					</div>
					<div class="hidden w-full lg:block">
						<DonutChart
							data={snapshot.apRevenue}
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
{/if}
