<script lang="ts">
	import { type Component } from 'svelte';
	import { Card, SectionHeading, Table, StatusBadge, EmptyState } from '$lib/components/ui';
	import { KpiCard, RevenueChart } from '$lib/components/feature';
	import Wallet from 'lucide-svelte/icons/wallet';
	import Gift from 'lucide-svelte/icons/gift';
	import Timer from 'lucide-svelte/icons/timer';
	import Wifi from 'lucide-svelte/icons/wifi';
	import Router from 'lucide-svelte/icons/router';
	import ReceiptText from 'lucide-svelte/icons/receipt-text';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ChevronUp from 'lucide-svelte/icons/chevron-up';
	import ChevronsUpDown from 'lucide-svelte/icons/chevrons-up-down';
	import { live, connectLive } from '$lib/live.svelte';
	import { createSort } from '$lib/sortable.svelte';
	import type { ActiveSession, StatusTone } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Presentation-only chrome for each headline metric — an icon, an honest caption for
	// what the (real) value represents, and a period tag. Keyed by the KPI's stable label
	// so it survives live-snapshot swaps. lucide types don't match Svelte's `Component`
	// structurally; cast as nav.ts does.
	const icon = (c: unknown) => c as Component;
	const kpiMeta: Record<string, { icon: Component; helper: string; period: string }> = {
		'Gross Revenue': { icon: icon(Wallet), helper: 'All-time top-ups', period: 'All-time' },
		'Free-Time Grants': { icon: icon(Gift), helper: 'Sessions on the house', period: 'All-time' },
		'Avg. Session': { icon: icon(Timer), helper: 'Mean connected time', period: 'All-time' }
	};

	// Tick a clock every second so session countdowns run live between SSE snapshots
	// (the snapshot only re-lands on DB writes — without this the timer looks frozen).
	let now = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});

	const pad = (n: number) => String(n).padStart(2, '0');
	/** Live remaining-time + tone/status from `expiresAt`, mirroring the server's
	 * formatting. Falls back to the snapshot values when there's no expiry. */
	function liveTimer(s: ActiveSession, nowMs: number): { left: string; tone: StatusTone; status: string } {
		if (!s.expiresAt) return { left: s.timeLeft, tone: s.tone, status: s.status };
		const total = Math.max(0, Math.floor((new Date(s.expiresAt).getTime() - nowMs) / 1000));
		const h = Math.floor(total / 3600);
		const m = Math.floor((total % 3600) / 60);
		const left = h > 0 ? `${h}:${pad(m)}:${pad(total % 60)}` : `${pad(m)}:${pad(total % 60)}`;
		if (total <= 0) return { left, tone: 'blocked', status: 'Expired' };
		if (total < 180) return { left, tone: 'warning', status: 'Low Time' };
		return { left, tone: 'online', status: 'Online' };
	}

	// Time-left text picks up the session's tone so a low/expired countdown reads as urgent
	// (amber/red) while healthy sessions stay neutral — mirrors the StatusBadge tone.
	const timeClass = (tone: StatusTone) =>
		tone === 'warning' ? 'text-warning' : tone === 'blocked' ? 'text-blocked' : 'text-ink';

	// Whole dashboard is live: SSR `data` seeds first paint, then the shared SSE stream
	// (event-driven by Postgres triggers — business rule #5, never poll client-side) takes
	// over every panel. Each field falls back to its SSR seed until the first frame lands.
	$effect(connectLive);
	const kpis = $derived(live.snapshot?.kpis ?? data.kpis);
	const revenue = $derived(live.snapshot?.revenue ?? data.revenue);
	const activeSessions = $derived(live.snapshot?.activeSessions ?? data.activeSessions);
	const networks = $derived(live.snapshot?.networks ?? data.networks);
	const total = $derived(revenue.reduce((sum, p) => sum + p.amount, 0));

	// Each panel has a fixed share of the grid height; the full row set renders and the
	// Table's body scrolls internally (sticky header) when it overflows — no row cap.

	// Network Health header badge — real online/total counts (no fabricated data).
	const onlineCount = $derived(networks.filter((ap) => ap.tone === 'online').length);
	const apTotal = $derived(networks.length);

	// Clickable-header sorting over the live rows (mirrors <UsersTable>/<TransactionsTable>).
	// `null` key keeps the snapshot order; clicking a header sorts, clicking it again flips.
	const toneRank: Record<StatusTone, number> = { online: 0, warning: 1, blocked: 2 };
	const num = (s: string) => Number(s.replace(/[^\d.]/g, '')) || 0; // "45 Mbps" → 45

	type SessSort = 'mac' | 'network' | 'package' | 'timeLeft';
	const sessionCols: { label: string; key: SessSort }[] = [
		{ label: 'MAC Address', key: 'mac' },
		{ label: 'Network', key: 'network' },
		{ label: 'Package', key: 'package' },
		{ label: 'Time Left', key: 'timeLeft' }
	];
	const sessSort = createSort<SessSort>({ mac: 'asc', network: 'asc', package: 'asc', timeLeft: 'asc' });
	// Remaining ms from expiresAt (live-sorts by soonest expiry); no expiry sinks to the bottom.
	const sessExpiry = (s: ActiveSession) => (s.expiresAt ? new Date(s.expiresAt).getTime() : Infinity);
	const sortedSessions = $derived(
		sessSort.apply(activeSessions, (a, b, key) => {
			if (key === 'mac') return a.mac.localeCompare(b.mac);
			if (key === 'network') return (a.network ?? '').localeCompare(b.network ?? '');
			if (key === 'package') return a.package.localeCompare(b.package);
			return sessExpiry(a) - sessExpiry(b); // timeLeft
		})
	);

	type NetSort = 'name' | 'status' | 'uptime' | 'latency' | 'speed';
	const netCols: { label: string; key: NetSort }[] = [
		{ label: 'Access Point', key: 'name' },
		{ label: 'Status', key: 'status' },
		{ label: 'Uptime', key: 'uptime' },
		{ label: 'Latency', key: 'latency' },
		{ label: 'Speed', key: 'speed' }
	];
	const netSort = createSort<NetSort>({
		name: 'asc',
		status: 'asc',
		uptime: 'desc',
		latency: 'asc',
		speed: 'desc'
	});
	const sortedNetworks = $derived(
		netSort.apply(networks, (a, b, key) => {
			if (key === 'name') return a.name.localeCompare(b.name);
			if (key === 'status') return toneRank[a.tone] - toneRank[b.tone];
			if (key === 'uptime') return num(a.uptime) - num(b.uptime);
			if (key === 'latency') return num(a.latency) - num(b.latency);
			return num(a.throughput) - num(b.throughput); // speed
		})
	);
</script>

<!-- Shared sortable header cell, reused by both dashboard tables (mirrors <UsersTable>). -->
{#snippet sortTh(label: string, active: boolean, dir: 'asc' | 'desc', onclick: () => void)}
	<th
		class="px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-muted uppercase"
		aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
	>
		<button
			type="button"
			{onclick}
			class="group inline-flex items-center gap-1 tracking-wider uppercase transition-colors hover:text-ink {active
				? 'text-ink'
				: ''}"
		>
			{label}
			{#if active}
				{#if dir === 'asc'}
					<ChevronUp class="h-3.5 w-3.5" aria-hidden="true" />
				{:else}
					<ChevronDown class="h-3.5 w-3.5" aria-hidden="true" />
				{/if}
			{:else}
				<ChevronsUpDown
					class="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-50"
					aria-hidden="true"
				/>
			{/if}
		</button>
	</th>
{/snippet}

<div class="dash">
	<!-- KPIs + Revenue share the left column: KPIs keep their natural height, revenue fills
	     the rest — so the sessions/network rows on the right can split the height evenly. -->
	<div class="leftcol flex min-h-0 flex-col gap-4">
		<section class="grid grid-cols-1 gap-4 sm:grid-cols-3">
			{#each kpis as kpi (kpi.label)}
				<KpiCard
					{kpi}
					icon={kpiMeta[kpi.label]?.icon}
					helper={kpiMeta[kpi.label]?.helper}
					period={kpiMeta[kpi.label]?.period}
				/>
			{/each}
		</section>

		<Card class="flex min-h-0 flex-1 flex-col">
			<SectionHeading title="Revenue — last 7 days" class="mb-4">
				{#snippet aside()}
					<span class="font-mono text-sm text-muted">₱{total.toLocaleString('en-PH')}</span>
				{/snippet}
			</SectionHeading>
			<div class="min-h-0 flex-1">
				{#if total > 0}
					<RevenueChart data={revenue} />
				{:else}
					<div class="flex h-full min-h-[150px] items-center justify-center">
						<EmptyState
							icon={icon(ReceiptText)}
							title="No revenue yet"
							description="Revenue appears here once guests purchase credits. The last 7 days will chart automatically."
							compact
						/>
					</div>
				{/if}
			</div>
		</Card>
	</div>

	<!-- Active Sessions -->
	<section class="sessions flex min-h-0 flex-col">
		<Table title="Active Sessions" class="min-h-0 flex-1">
			{#snippet aside()}
				{#if activeSessions.length > 0}
					<span
						class="inline-flex items-center gap-1.5 rounded-full bg-online/10 px-2.5 py-1 text-xs font-medium text-online"
					>
						<span class="h-1.5 w-1.5 rounded-full bg-online" aria-hidden="true"></span>
						{activeSessions.length} connected
					</span>
				{/if}
			{/snippet}
			{#snippet headRow()}
				<tr class="border-b border-border bg-surface">
					{#each sessionCols as c (c.key)}
						{@render sortTh(c.label, sessSort.key === c.key, sessSort.dir, () => sessSort.toggle(c.key))}
					{/each}
				</tr>
			{/snippet}
			{#each sortedSessions as session (session.id)}
				{@const t = liveTimer(session, now)}
				<tr class="transition-colors hover:bg-surface">
					<td class="px-4 py-3 font-mono text-xs text-ink">{session.mac}</td>
					<td class="px-4 py-3 text-ink">{session.network ?? '—'}</td>
					<td class="px-4 py-3">
						<span class="inline-flex rounded-md bg-surface px-2 py-0.5 text-xs font-medium text-ink">
							{session.package}
						</span>
					</td>
					<td class="px-4 py-3 font-mono {timeClass(t.tone)}">{t.left}</td>
				</tr>
			{/each}
			{#if activeSessions.length === 0}
				<tr>
					<td colspan={sessionCols.length} class="p-0">
						<EmptyState
							icon={icon(Wifi)}
							title="No active sessions"
							description="Connected guests appear here automatically as they come online — the list streams live, no refresh needed."
							compact
						/>
					</td>
				</tr>
			{/if}
			{#snippet footer()}
				<div class="px-4 py-2.5">
					<span class="text-xs text-muted">Streaming via RADIUS accounting</span>
				</div>
			{/snippet}
		</Table>
	</section>

	<!-- Network Health -->
	<section class="network flex min-h-0 flex-col">
		<Table title="Network Health" class="min-h-0 flex-1">
			{#snippet aside()}
				<div class="flex items-center gap-2">
					{#if apTotal > 0}
						<StatusBadge tone="online" label="{onlineCount}/{apTotal} online" />
					{/if}
					<a href="/networks" class="text-xs font-medium text-brand hover:underline">View all</a>
				</div>
			{/snippet}
			{#snippet headRow()}
				<tr class="border-b border-border bg-surface">
					{#each netCols as c (c.key)}
						{@render sortTh(c.label, netSort.key === c.key, netSort.dir, () => netSort.toggle(c.key))}
					{/each}
				</tr>
			{/snippet}
			{#each sortedNetworks as ap (ap.id)}
				<tr class="transition-colors hover:bg-surface">
					<td class="px-4 py-3 font-medium text-ink">{ap.name}</td>
					<td class="px-4 py-3">
						<StatusBadge tone={ap.tone} label={ap.status} pulse={ap.tone !== 'online'} />
					</td>
					<td class="px-4 py-3 font-mono text-ink">{ap.uptime}</td>
					<td class="px-4 py-3 font-mono text-ink">{ap.latency}</td>
					<td class="px-4 py-3 font-mono text-ink">{ap.throughput}</td>
				</tr>
			{/each}
			{#if networks.length === 0}
				<tr>
					<td colspan={netCols.length} class="p-0">
						<EmptyState
							icon={icon(Router)}
							title="No access points reporting"
							description="AP health appears here once your access points start reporting uptime and latency metrics."
							compact
						/>
					</td>
				</tr>
			{/if}
			{#snippet footer()}
				<div class="px-4 py-2.5">
					<span class="text-xs text-muted">ICMP ping · 30s interval</span>
				</div>
			{/snippet}
		</Table>
	</section>
</div>

<style>
	/* Height-filling grid: fills <main> exactly so the page never scrolls. Base (mobile)
	   is a single stacked column; the chosen arrangement only diverges at lg+. */
	.dash {
		display: grid;
		height: 100%;
		min-height: 0;
		gap: 1rem;
		grid-template-columns: 1fr;
		grid-template-rows: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
		grid-template-areas: 'leftcol' 'sessions' 'network';
	}

	.leftcol {
		grid-area: leftcol;
	}
	.sessions {
		grid-area: sessions;
	}
	.network {
		grid-area: network;
	}

	@media (min-width: 1024px) {
		/* Bento: KPIs+revenue fill the left column; sessions over network on the right, with
		   two equal rows so the two tables split the right column's height 50/50. */
		.dash {
			grid-template-columns: 1fr 1fr;
			grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
			grid-template-areas:
				'leftcol sessions'
				'leftcol network';
		}
	}
</style>
