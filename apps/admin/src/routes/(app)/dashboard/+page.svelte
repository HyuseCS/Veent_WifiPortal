<script lang="ts">
	import { Card, SectionHeading } from '$lib/components/ui';
	import { KpiCard, RevenueChart, SessionsTable } from '$lib/components/feature';
	// MOCK: replace these imports with `let { data } = $props()` when backend lands.
	import { kpis, revenue, activeSessions } from '$lib/mocks';

	const total = $derived(revenue.reduce((sum, p) => sum + p.amount, 0));
</script>

<div class="space-y-6">
	<section class="grid gap-4" style="grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));">
		{#each kpis as kpi (kpi.label)}
			<KpiCard {kpi} />
		{/each}
	</section>

	<Card>
		<SectionHeading title="Revenue — last 7 days" class="mb-4">
			{#snippet aside()}
				<span class="font-mono text-sm text-muted">₱{total.toLocaleString('en-PH')}</span>
			{/snippet}
		</SectionHeading>
		<RevenueChart data={revenue} />
	</Card>

	<section>
		<SectionHeading title="Active Sessions" class="mb-3" />
		<SessionsTable sessions={activeSessions} />
	</section>
</div>
