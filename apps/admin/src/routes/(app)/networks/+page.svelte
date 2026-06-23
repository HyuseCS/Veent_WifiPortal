<script lang="ts">
	import type { Component } from 'svelte';
	import { Card, FilterTabs } from '$lib/components/ui';
	import { NetworkHealthCard, RouterLogPanel, CoverageMap, KpiCard } from '$lib/components/feature';
	import Router from 'lucide-svelte/icons/router';
	import Users from 'lucide-svelte/icons/users';
	import Gauge from 'lucide-svelte/icons/gauge';
	import Timer from 'lucide-svelte/icons/timer';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import type { NetworkAp, StatusTone } from '$lib/types';
	import type { PageData } from './$types';

	// lucide types don't match Svelte's `Component` structurally; cast as dashboard/nav do.
	const icon = (c: unknown) => c as Component;

	let { data }: { data: PageData } = $props();
	const networks = $derived(data.networks);

	// All KPIs/counts derive purely from the loaded AP list — no extra data sources.
	const total = $derived(networks.length);
	const cntHealthy = $derived(networks.filter((n) => n.tone === 'online').length);
	const cntDegraded = $derived(networks.filter((n) => n.tone === 'warning').length);
	const cntOffline = $derived(networks.filter((n) => n.tone === 'blocked').length);
	const onlineCount = $derived(cntHealthy + cntDegraded);
	const usersTotal = $derived(networks.reduce((s, n) => s + n.users, 0));

	// Metrics arrive pre-formatted ("47 Mbps", "22ms") — pull the leading number to aggregate.
	const lead = (s: string): number => parseFloat(s);
	const tputTotal = $derived(
		Math.round(
			networks.reduce(
				(s, n) => s + (Number.isFinite(lead(n.throughput)) ? lead(n.throughput) : 0),
				0
			)
		)
	);
	const latVals = $derived(networks.map((n) => lead(n.latency)).filter((v) => Number.isFinite(v)));
	const avgLat = $derived(
		latVals.length ? Math.round(latVals.reduce((s, v) => s + v, 0) / latVals.length) : null
	);
	const alerts = $derived(cntDegraded + cntOffline);
	const placedCount = $derived(
		networks.filter((n) => n.latitude != null && n.longitude != null).length
	);

	// Feeds the shared <KpiCard> (same component as Dashboard/Finance). `tone`/`captionTone`
	// carry the status colour; `unit` is the muted value suffix.
	type NetKpi = {
		label: string;
		value: string;
		icon: Component;
		caption: string;
		unit?: string;
		tone?: StatusTone;
		captionTone?: StatusTone;
	};
	const kpis = $derived<NetKpi[]>([
		{
			label: 'Access Points',
			value: String(total),
			icon: icon(Router),
			caption: `${onlineCount} online`,
			captionTone: 'online'
		},
		{
			label: 'Connected Users',
			value: String(usersTotal),
			icon: icon(Users),
			caption: 'across the venue'
		},
		{
			label: 'Total Throughput',
			value: String(tputTotal),
			unit: 'Mbps',
			icon: icon(Gauge),
			caption: 'aggregate uplink'
		},
		{
			label: 'Avg Latency',
			value: avgLat == null ? '—' : String(avgLat),
			unit: avgLat == null ? undefined : 'ms',
			icon: icon(Timer),
			caption: 'across active APs'
		},
		{
			label: 'Alerts',
			value: String(alerts),
			icon: icon(TriangleAlert),
			caption: 'needs attention',
			tone: 'blocked',
			captionTone: 'blocked'
		}
	]);

	// Fleet donut: healthy → degraded → offline, token-coloured. Grey when empty.
	const donut = $derived.by(() => {
		if (total === 0) return 'var(--color-border)';
		const h = (cntHealthy / total) * 100;
		const d = (cntDegraded / total) * 100;
		return `conic-gradient(var(--color-online) 0 ${h}%, var(--color-warning) ${h}% ${h + d}%, var(--color-blocked) ${h + d}% 100%)`;
	});

	const fleet = $derived([
		{ dot: 'bg-online', label: 'Healthy', count: cntHealthy },
		{ dot: 'bg-warning', label: 'Degraded', count: cntDegraded },
		{ dot: 'bg-blocked', label: 'Offline', count: cntOffline }
	]);

	const legend = [
		{ dot: 'bg-online', label: 'Healthy' },
		{ dot: 'bg-warning', label: 'Degraded' },
		{ dot: 'bg-blocked', label: 'Offline' }
	];

	// Status filter for the AP grid. 'all' shows everything; otherwise filter by tone.
	type Filter = 'all' | StatusTone;
	let filter = $state<Filter>('all');
	const filterDefs = $derived([
		{ key: 'all' as const, label: 'All', count: total },
		{ key: 'online' as const, label: 'Healthy', count: cntHealthy },
		{ key: 'warning' as const, label: 'Degraded', count: cntDegraded },
		{ key: 'blocked' as const, label: 'Offline', count: cntOffline }
	]);
	const visible = $derived(
		filter === 'all' ? networks : networks.filter((n: NetworkAp) => n.tone === filter)
	);

	// Selecting a card flies the coverage map to that AP (and rings the card), and
	// scrolls the map into view so the focus is visible on small/scrolled layouts.
	let selectedId = $state<string | null>(null);
	// Only one card may edit at a time, so at most one MapPicker (Leaflet) mounts.
	let editingId = $state<string | null>(null);
	let mapEl: HTMLDivElement;
	function focusAp(id: string) {
		selectedId = id;
		mapEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

<div class="space-y-5">
	<!-- KPI STRIP -->
	<section class="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
		{#each kpis as k (k.label)}
			<KpiCard
				kpi={{ label: k.label, value: k.value }}
				icon={k.icon}
				unit={k.unit}
				helper={k.caption}
				tone={k.tone}
				captionTone={k.captionTone}
			/>
		{/each}
	</section>

	<!-- MAP + RIGHT PANELS -->
	<div class="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] xl:items-stretch">
		<!-- Coverage map -->
		<Card padding="p-0" class="flex flex-col overflow-hidden">
			<div class="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
				<div>
					<h2 class="text-base font-semibold text-ink">Coverage Map</h2>
					<p class="mt-0.5 text-xs text-muted">
						{placedCount} of {total} access points placed
					</p>
				</div>
				<div class="flex flex-wrap gap-3.5">
					{#each legend as leg (leg.label)}
						<span class="flex items-center gap-1.5 text-xs font-medium text-muted">
							<span class="h-2 w-2 rounded-full {leg.dot}"></span>{leg.label}
						</span>
					{/each}
				</div>
			</div>
			<div
				bind:this={mapEl}
				class="relative mx-4 mb-4 min-h-107.5 flex-1 scroll-mt-4 overflow-hidden rounded-xl border border-border"
			>
				<div class="absolute inset-0">
					<CoverageMap {networks} {selectedId} onselect={focusAp} />
				</div>
			</div>
		</Card>

		<!-- Right column: fleet status + router log -->
		<div class="flex min-w-0 flex-col gap-5">
			<Card class="flex flex-col gap-4">
				<h2 class="text-base font-semibold text-ink">Fleet Status</h2>
				<div class="flex items-center gap-5">
					<div class="relative h-28 w-28 shrink-0 rounded-full" style="background: {donut}">
						<div
							class="absolute inset-3.5 flex flex-col items-center justify-center rounded-full bg-bg"
						>
							<span class="font-mono text-2xl font-extrabold text-ink">{total}</span>
							<span class="text-[10px] font-bold tracking-wide text-muted uppercase">Total APs</span
							>
						</div>
					</div>
					<ul class="flex min-w-0 flex-1 flex-col gap-2.5">
						{#each fleet as row (row.label)}
							<li class="flex items-center gap-2.5">
								<span class="h-2.5 w-2.5 rounded {row.dot}"></span>
								<span class="text-sm font-medium text-muted">{row.label}</span>
								<span class="ml-auto font-mono text-sm font-bold text-ink">{row.count}</span>
							</li>
						{/each}
					</ul>
				</div>
			</Card>

			<div class="min-h-80 flex-1">
				<RouterLogPanel />
			</div>
		</div>
	</div>

	<!-- AP CARDS -->
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h2 class="text-base font-semibold text-ink">Access Points</h2>
			<p class="mt-0.5 text-xs text-muted">Health per access point across the venue</p>
		</div>
		<FilterTabs tabs={filterDefs} active={filter} onselect={(key) => (filter = key)} />
	</div>

	{#if visible.length === 0}
		<p
			class="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted"
		>
			No access points match this filter.
			<button onclick={() => (filter = 'all')} class="cursor-pointer text-brand underline">
				Show all
			</button>
		</p>
	{:else}
		<!-- auto-fill (not auto-fit): keeps empty tracks so a lone card stays its natural
		     width instead of stretching across the whole row. -->
		<section
			class="grid items-start gap-4"
			style="grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));"
		>
			{#each visible as ap (ap.id)}
				<NetworkHealthCard
					{ap}
					selected={ap.id === selectedId}
					onfocus={focusAp}
					editing={ap.id === editingId}
					onedit={(id) => (editingId = id)}
				/>
			{/each}
		</section>
	{/if}
</div>
