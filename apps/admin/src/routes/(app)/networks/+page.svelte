<script lang="ts">
	import type { Component } from 'svelte';
	import { Card, FilterTabs, Button } from '$lib/components/ui';
	import {
		NetworkHealthCard,
		RouterLogPanel,
		CoverageMap,
		KpiCard,
		KpiCarousel,
		WipeDialog
	} from '$lib/components/feature';
	import Router from 'lucide-svelte/icons/router';
	import Users from 'lucide-svelte/icons/users';
	import Gauge from 'lucide-svelte/icons/gauge';
	import Timer from 'lucide-svelte/icons/timer';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import type { NetworkAp, StatusTone } from '$lib/types';
	import { live, connectLive } from '$lib/live.svelte';
	import type { PageData, ActionData } from './$types';

	// lucide types don't match Svelte's `Component` structurally; cast as dashboard/nav do.
	const icon = (c: unknown) => c as Component;

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Two data sources, both non-blocking:
	//  • `data.networks` is STREAMED (a promise) so the tab switches instantly (see `load`),
	//    and carries router-fresh health (the load refreshes the router first).
	//  • the shared LIVE snapshot — the same /api/connected stream the Topbar already opens —
	//    pushes every AP/session change in realtime (business rule #5, no polling).
	// We prefer live, falling back to the streamed SSR seed until the first frame lands.
	$effect(connectLive);
	let streamedNetworks = $state<NetworkAp[]>([]);
	let streamResolved = $state(false);
	$effect(() => {
		const pending = data.networks;
		let cancelled = false;
		Promise.resolve(pending)
			.then((n) => {
				if (cancelled) return;
				streamedNetworks = n;
				streamResolved = true;
			})
			.catch(() => {
				if (!cancelled) streamResolved = true; // surface the empty state rather than hang
			});
		return () => {
			cancelled = true;
		};
	});
	const networks = $derived(live.snapshot?.networks ?? streamedNetworks);
	// Skeleton until data arrives from EITHER source (live frame or the streamed seed).
	const ready = $derived(streamResolved || live.snapshot != null);

	// Owner-only, step-up-verified wipe of every access point. The two-step flow lives in
	// the shared <WipeDialog> (same component the Users page uses).
	let wipeOpen = $state(false);

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
		onclick?: () => void;
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
			// Honest at zero: green "all clear" instead of a red "needs attention" on 0.
			caption: alerts > 0 ? 'view affected APs' : 'all clear',
			tone: alerts > 0 ? 'blocked' : 'online',
			captionTone: alerts > 0 ? 'blocked' : 'online',
			// Clicking drills into the offending APs (degraded + offline). No-op at zero.
			onclick: alerts > 0 ? showAlerts : undefined
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

	// Status filter for the AP grid. 'all' shows everything; 'alerts' is the union of the
	// two problem tones (degraded + offline) — the drill-down target of the Alerts KPI;
	// otherwise filter by a single tone. The 'alerts' tab only appears when there are any.
	type Filter = 'all' | 'alerts' | StatusTone;
	let filter = $state<Filter>('all');
	const filterDefs = $derived([
		{ key: 'all' as const, label: 'All', count: total },
		...(alerts > 0 ? [{ key: 'alerts' as const, label: 'Alerts', count: alerts }] : []),
		{ key: 'online' as const, label: 'Healthy', count: cntHealthy },
		{ key: 'warning' as const, label: 'Degraded', count: cntDegraded },
		{ key: 'blocked' as const, label: 'Offline', count: cntOffline }
	]);
	const visible = $derived(
		filter === 'all'
			? networks
			: filter === 'alerts'
				? networks.filter((n: NetworkAp) => n.tone === 'warning' || n.tone === 'blocked')
				: networks.filter((n: NetworkAp) => n.tone === filter)
	);

	// Selecting a card flies the coverage map to that AP (and rings the card), and
	// scrolls the map into view so the focus is visible on small/scrolled layouts.
	let selectedId = $state<string | null>(null);
	let mapEl = $state<HTMLDivElement>();
	function focusAp(id: string) {
		selectedId = id;
		mapEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	// Alerts KPI drill-down: filter the AP grid to the offending APs and scroll the grid
	// into view so the click visibly lands on "what it's talking about".
	let apSectionEl = $state<HTMLDivElement>();
	function showAlerts() {
		filter = 'alerts';
		apSectionEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

{#snippet skelCard()}
	<div class="flex flex-col gap-4 rounded-xl border border-border bg-bg p-5 shadow-sm">
		<div class="flex items-start justify-between gap-2">
			<div class="h-3 w-20 rounded bg-surface"></div>
			<div class="h-9 w-9 rounded-lg bg-surface"></div>
		</div>
		<div class="h-7 w-16 rounded bg-surface"></div>
		<div class="h-3 w-24 rounded bg-surface"></div>
	</div>
{/snippet}

{#if !ready}
	<!-- Skeleton silhouette: mirrors the real layout (KPI strip · map + panels · AP grid)
	     so the tab paints instantly while the streamed router health resolves. -->
	<div class="animate-pulse space-y-5" aria-hidden="true">
		<section class="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
			{#each Array.from({ length: 5 }, (_, i) => i) as i (i)}{@render skelCard()}{/each}
		</section>
		<div class="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
			<div class="min-h-107.5 rounded-xl border border-border bg-bg shadow-sm"></div>
			<div class="flex flex-col gap-5">
				<div class="h-44 rounded-xl border border-border bg-bg shadow-sm"></div>
				<div class="min-h-80 rounded-xl border border-border bg-bg shadow-sm"></div>
			</div>
		</div>
		<section
			class="grid items-start gap-4"
			style="grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));"
		>
			{#each Array.from({ length: 3 }, (_, i) => i) as i (i)}
				<div class="h-48 rounded-xl border border-border bg-bg shadow-sm"></div>
			{/each}
		</section>
	</div>
{:else}
<div class="contents">
	<!-- SCREEN 1: KPIs + coverage map + side panels -->
	<div class="min-h-full snap-start space-y-5 pt-5 pb-5">
		<!-- KPI STRIP -->
		<KpiCarousel items={kpis}>
			{#snippet card(k)}
				<KpiCard
					kpi={{ label: k.label, value: k.value }}
					icon={k.icon}
					unit={k.unit}
					helper={k.caption}
					tone={k.tone}
					captionTone={k.captionTone}
					onclick={k.onclick}
					compact
				/>
			{/snippet}
		</KpiCarousel>

		<!-- MAP + RIGHT PANELS -->
		<div class="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] xl:items-stretch">
			<!-- Coverage map -->
			<Card padding="p-0" class="flex h-[60dvh] flex-col overflow-hidden xl:h-[65vh]">
				<div class="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
					<div>
						<h2 class="text-base font-semibold text-ink">Coverage Map</h2>
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
					class="relative mx-4 mb-4 min-h-0 flex-1 scroll-mt-4 overflow-hidden rounded-xl border border-border"
				>
					<div class="absolute inset-0">
						<CoverageMap {networks} {selectedId} onselect={focusAp} />
					</div>
				</div>
			</Card>

			<!-- Right column: fleet status + router log -->
			<div class="flex min-w-0 flex-col gap-5 xl:h-[65vh]">
				<Card class="flex flex-col gap-4">
					<h2 class="text-base font-semibold text-ink">Fleet Status</h2>
					<div class="flex items-center gap-5">
						<div class="relative h-25 w-25 shrink-0 rounded-full" style="background: {donut}">
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

				<div class="h-[37vh] xl:h-auto xl:min-h-0 xl:flex-1">
					<RouterLogPanel />
				</div>
			</div>
		</div>
	</div>

	<!-- SCREEN 2: access point cards -->
	<div class="min-h-full snap-start space-y-5 pt-1">
		<!-- AP CARDS -->
		<div
			bind:this={apSectionEl}
			class="flex scroll-mt-4 flex-wrap items-center justify-between gap-3"
		>
			<div>
				<h2 class="text-base font-semibold text-ink">Access Points</h2>
				<p class="mt-0.5 text-xs text-muted">Health per access point across the venue</p>
			</div>
			<div class="flex flex-wrap items-center gap-3">
				<FilterTabs tabs={filterDefs} active={filter} onselect={(key) => (filter = key)} />
				{#if data.isOwner}
					<Button variant="danger" onclick={() => (wipeOpen = true)}>
						<Trash2 class="h-4 w-4" aria-hidden="true" />
						Wipe database
					</Button>
				{/if}
			</div>
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
			style="grid-template-columns: repeat(auto-fill, minmax(min(330px, 100%), 1fr));"
		>
			{#each visible as ap (ap.id)}
				<NetworkHealthCard
					{ap}
					selected={ap.id === selectedId}
					canDelete={data.isOwner}
					onfocus={focusAp}
				/>
			{/each}
		</section>
	{/if}
	</div>
</div>
{/if}

{#if data.isOwner}
	<WipeDialog
		bind:open={wipeOpen}
		title="Wipe network database"
		count={networks.length}
		noun="access points"
		detail="their health and location data"
		{form}
	/>
{/if}
