<script lang="ts">
	import { type Component } from 'svelte';
	import {
		Card,
		SectionHeading,
		Table,
		SortHeader,
		StatusBadge,
		EmptyState
	} from '$lib/components/ui';
	import { KpiCard, RevenueChart } from '$lib/components/feature';
	import Wallet from 'lucide-svelte/icons/wallet';
	import Gift from 'lucide-svelte/icons/gift';
	import Timer from 'lucide-svelte/icons/timer';
	import Wifi from 'lucide-svelte/icons/wifi';
	import Router from 'lucide-svelte/icons/router';
	import ReceiptText from 'lucide-svelte/icons/receipt-text';
	import { live, connectLive } from '$lib/live.svelte';
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

	// Logical status order via tone (online → warning → blocked), not alphabetical.
	const toneRank: Record<StatusTone, number> = { online: 0, warning: 1, blocked: 2 };
	// Pull the leading number out of a pre-formatted metric ("47 Mbps", "22ms", "99.9%").
	const lead = (s: string) => parseFloat(s) || 0;

	// --- Active Sessions: clickable-header sort (null = server order). ---
	type SessKey = 'mac' | 'network' | 'package' | 'timeLeft';
	let sessSortKey = $state<SessKey | null>(null);
	let sessSortDir = $state<'asc' | 'desc'>('asc');
	const sessDefaultDir: Record<SessKey, 'asc' | 'desc'> = {
		mac: 'asc',
		network: 'asc',
		package: 'asc',
		timeLeft: 'asc'
	};
	function sessSort(key: SessKey) {
		if (sessSortKey === key) sessSortDir = sessSortDir === 'asc' ? 'desc' : 'asc';
		else {
			sessSortKey = key;
			sessSortDir = sessDefaultDir[key];
		}
	}
	// Sort by expiry time (soonest first) for Time Left; null-expiry rows sort last.
	const expMs = (s: ActiveSession) => (s.expiresAt ? new Date(s.expiresAt).getTime() : Infinity);
	const sortedSessions = $derived.by(() => {
		if (!sessSortKey) return activeSessions;
		const key = sessSortKey;
		const dir = sessSortDir === 'asc' ? 1 : -1;
		return [...activeSessions].sort((a, b) => {
			let cmp = 0;
			if (key === 'mac') cmp = a.mac.localeCompare(b.mac);
			else if (key === 'network') cmp = (a.network ?? '').localeCompare(b.network ?? '');
			else if (key === 'package') cmp = a.package.localeCompare(b.package);
			else cmp = expMs(a) - expMs(b); // timeLeft
			return cmp * dir;
		});
	});
	const sessionCols: { label: string; key: SessKey }[] = [
		{ label: 'MAC Address', key: 'mac' },
		{ label: 'Network', key: 'network' },
		{ label: 'Package', key: 'package' },
		{ label: 'Time Left', key: 'timeLeft' }
	];

	// --- Network Health: clickable-header sort (null = server order). ---
	type NetKey = 'name' | 'status' | 'uptime' | 'latency' | 'speed';
	let netSortKey = $state<NetKey | null>(null);
	let netSortDir = $state<'asc' | 'desc'>('asc');
	const netDefaultDir: Record<NetKey, 'asc' | 'desc'> = {
		name: 'asc',
		status: 'asc',
		uptime: 'desc',
		latency: 'asc',
		speed: 'desc'
	};
	function netSort(key: NetKey) {
		if (netSortKey === key) netSortDir = netSortDir === 'asc' ? 'desc' : 'asc';
		else {
			netSortKey = key;
			netSortDir = netDefaultDir[key];
		}
	}
	const sortedNetworks = $derived.by(() => {
		if (!netSortKey) return networks;
		const key = netSortKey;
		const dir = netSortDir === 'asc' ? 1 : -1;
		return [...networks].sort((a, b) => {
			let cmp = 0;
			if (key === 'name') cmp = a.name.localeCompare(b.name);
			else if (key === 'status') cmp = toneRank[a.tone] - toneRank[b.tone];
			else if (key === 'uptime') cmp = lead(a.uptime) - lead(b.uptime);
			else if (key === 'latency') cmp = lead(a.latency) - lead(b.latency);
			else cmp = lead(a.throughput) - lead(b.throughput); // speed
			return cmp * dir;
		});
	});
	const netCols: { label: string; key: NetKey }[] = [
		{ label: 'Access Point', key: 'name' },
		{ label: 'Status', key: 'status' },
		{ label: 'Uptime', key: 'uptime' },
		{ label: 'Latency', key: 'latency' },
		{ label: 'Speed', key: 'speed' }
	];
</script>

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
					{#each sessionCols as col (col.key)}
						<SortHeader
							label={col.label}
							active={sessSortKey === col.key}
							dir={sessSortDir}
							onsort={() => sessSort(col.key)}
						/>
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
					{#each netCols as col (col.key)}
						<SortHeader
							label={col.label}
							active={netSortKey === col.key}
							dir={netSortDir}
							onsort={() => netSort(col.key)}
						/>
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
