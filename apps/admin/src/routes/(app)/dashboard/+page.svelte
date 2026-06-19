<script lang="ts">
	import { getContext } from 'svelte';
	import { Card, SectionHeading, Table, StatusBadge } from '$lib/components/ui';
	import { KpiCard, RevenueChart } from '$lib/components/feature';
	import { live, connectLive } from '$lib/live.svelte';
	import { DASH_LAYOUT_CTX, type DashLayoutCtx } from '$lib/dashboard-layout';
	import type { ActiveSession, StatusTone } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

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

	// Whole dashboard is live: SSR `data` seeds first paint, then the shared SSE stream
	// (event-driven by Postgres triggers — business rule #5, never poll client-side) takes
	// over every panel. Each field falls back to its SSR seed until the first frame lands.
	$effect(connectLive);
	const kpis = $derived(live.snapshot?.kpis ?? data.kpis);
	const revenue = $derived(live.snapshot?.revenue ?? data.revenue);
	const activeSessions = $derived(live.snapshot?.activeSessions ?? data.activeSessions);
	const networks = $derived(live.snapshot?.networks ?? data.networks);
	const total = $derived(revenue.reduce((sum, p) => sum + p.amount, 0));

	// Chosen arrangement comes from the header switcher via shared context (see (app)/+layout).
	const layoutCtx = getContext<DashLayoutCtx>(DASH_LAYOUT_CTX);

	// Single-screen budget: cap the variable tables so nothing pushes the page past one
	// viewport. Overflow rows collapse into a "+N more" / "View all" affordance instead of
	// a scrollbar (panels are overflow-hidden; <main> scroll is only a last-resort net).
	const SESSION_CAP = 6;
	const NET_CAP = 4;
	const shownSessions = $derived(activeSessions.slice(0, SESSION_CAP));
	const moreSessions = $derived(Math.max(0, activeSessions.length - SESSION_CAP));
	const shownNetworks = $derived(networks.slice(0, NET_CAP));
	const moreNetworks = $derived(Math.max(0, networks.length - NET_CAP));

	const sessionCols = [
		{ label: 'MAC Address' },
		{ label: 'Package' },
		{ label: 'Time Left' },
		{ label: 'Status' }
	];
	const netCols = [
		{ label: 'Access Point' },
		{ label: 'Status' },
		{ label: 'Uptime' },
		{ label: 'Latency' }
	];
</script>

<div class="dash dash-{layoutCtx.current}">
	<!-- KPIs + Revenue share the left column: KPIs keep their natural height, revenue fills
	     the rest — so the sessions/network rows on the right can split the height evenly. -->
	<div class="leftcol flex min-h-0 flex-col gap-4">
		<section class="grid grid-cols-1 gap-4 sm:grid-cols-3">
			{#each kpis as kpi (kpi.label)}
				<KpiCard {kpi} />
			{/each}
		</section>

		<Card class="flex min-h-0 flex-1 flex-col">
			<SectionHeading title="Revenue — last 7 days" class="mb-4">
				{#snippet aside()}
					<span class="font-mono text-sm text-muted">₱{total.toLocaleString('en-PH')}</span>
				{/snippet}
			</SectionHeading>
			<div class="min-h-0 flex-1">
				<RevenueChart data={revenue} />
			</div>
		</Card>
	</div>

	<!-- Active Sessions -->
	<section class="sessions flex min-h-0 flex-col">
		<Table title="Active Sessions" columns={sessionCols} class="min-h-0 flex-1">
			{#each shownSessions as session (session.mac)}
				{@const t = liveTimer(session, now)}
				<tr class="transition-colors hover:bg-surface">
					<td class="px-4 py-2.5 font-mono text-xs text-ink">{session.mac}</td>
					<td class="px-4 py-2.5 text-ink">{session.package}</td>
					<td class="px-4 py-2.5 font-mono text-ink">{t.left}</td>
					<td class="px-4 py-2.5">
						<StatusBadge tone={t.tone} label={t.status} />
					</td>
				</tr>
			{/each}
			{#if shownSessions.length === 0}
				<tr>
					<td colspan={sessionCols.length} class="px-4 py-6 text-center text-sm text-muted">
						No active sessions.
					</td>
				</tr>
			{/if}
		</Table>
		{#if moreSessions > 0}
			<p class="pt-2 text-xs text-muted">+{moreSessions} more active</p>
		{/if}
	</section>

	<!-- Network Health -->
	<section class="network flex min-h-0 flex-col">
		<Table title="Network Health" columns={netCols} class="min-h-0 flex-1">
			{#snippet aside()}
				<a href="/networks" class="text-xs font-medium text-brand hover:underline">View all</a>
			{/snippet}
			{#each shownNetworks as ap (ap.id)}
				<tr class="transition-colors hover:bg-surface">
					<td class="px-4 py-2.5 text-ink">{ap.name}</td>
					<td class="px-4 py-2.5"><StatusBadge tone={ap.tone} label={ap.status} /></td>
					<td class="px-4 py-2.5 font-mono text-ink">{ap.uptime}</td>
					<td class="px-4 py-2.5 font-mono text-ink">{ap.latency}</td>
				</tr>
			{/each}
			{#if shownNetworks.length === 0}
				<tr>
					<td colspan={netCols.length} class="px-4 py-6 text-center text-sm text-muted">
						No access points reporting.
					</td>
				</tr>
			{/if}
		</Table>
		{#if moreNetworks > 0}
			<p class="pt-2 text-xs text-muted">+{moreNetworks} more access points</p>
		{/if}
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
		.dash-bento {
			grid-template-columns: 1fr 1fr;
			grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
			grid-template-areas:
				'leftcol sessions'
				'leftcol network';
		}

		/* Two columns: left is KPIs+revenue over network, right is sessions at full height. */
		.dash-split {
			grid-template-columns: 1.4fr 1fr;
			grid-template-rows: minmax(0, 1fr) auto;
			grid-template-areas:
				'leftcol sessions'
				'network sessions';
		}

		/* Stacked: single column — KPIs+revenue, then sessions and network split the rest. */
		.dash-stacked {
			grid-template-columns: 1fr;
			grid-template-rows: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
			grid-template-areas: 'leftcol' 'sessions' 'network';
		}
	}
</style>
