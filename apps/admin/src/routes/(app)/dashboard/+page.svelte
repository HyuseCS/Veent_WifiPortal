<script lang="ts">
	import KpiCard from '$lib/components/KpiCard.svelte';
	import RevenueChart from '$lib/components/RevenueChart.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	// MOCK: replace these imports with `let { data } = $props()` when backend lands.
	import { kpis, revenue, activeSessions } from '$lib/mocks';

	const total = revenue.reduce((sum, p) => sum + p.amount, 0);
</script>

<div class="space-y-6">
	<section class="grid gap-4" style="grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));">
		{#each kpis as kpi (kpi.label)}
			<KpiCard {kpi} />
		{/each}
	</section>

	<section class="rounded-lg border border-border bg-bg p-5">
		<div class="mb-4 flex items-center justify-between">
			<h2 class="text-base font-semibold text-ink">Revenue — last 7 days</h2>
			<span class="font-mono text-sm text-muted">₱{total.toLocaleString('en-PH')}</span>
		</div>
		<RevenueChart data={revenue} />
	</section>

	<section>
		<h2 class="mb-3 text-base font-semibold text-ink">Active Sessions</h2>
		<div class="overflow-hidden rounded-lg border border-border bg-bg">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-border bg-surface">
						<th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-muted uppercase">
							MAC Address
						</th>
						<th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-muted uppercase">
							Package
						</th>
						<th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-muted uppercase">
							Time Left
						</th>
						<th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-muted uppercase">
							Status
						</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-border">
					{#each activeSessions as session (session.mac)}
						<tr class="transition-colors hover:bg-surface">
							<td class="px-4 py-3 font-mono text-xs text-ink">{session.mac}</td>
							<td class="px-4 py-3 text-ink">{session.package}</td>
							<td class="px-4 py-3 font-mono text-ink">{session.timeLeft}</td>
							<td class="px-4 py-3">
								<StatusBadge tone={session.tone} label={session.status} />
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
</div>
