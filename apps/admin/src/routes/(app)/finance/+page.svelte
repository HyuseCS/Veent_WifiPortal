<script lang="ts">
	import { Card, SectionHeading, Table, StatusBadge } from '$lib/components/ui';
	import { KpiCard, RevenueChart, DonutChart } from '$lib/components/feature';
	import Download from 'lucide-svelte/icons/download';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const PERIODS = [
		{ key: '7d', label: '7 days' },
		{ key: '30d', label: '30 days' },
		{ key: '90d', label: '90 days' },
		{ key: 'all', label: 'All time' }
	];

	const revenueTotal = $derived(data.revenue.reduce((sum, p) => sum + p.amount, 0));

	const txCols = [
		{ label: 'Date' },
		{ label: 'Status' },
		{ label: 'Amount' },
		{ label: 'Method' },
		{ label: 'Buyer' },
		{ label: 'Receipt' }
	];

	const dateFmt = new Intl.DateTimeFormat('en-PH', {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
	const fmtDate = (iso: string) => dateFmt.format(new Date(iso));
</script>

<div class="space-y-6">
	<!-- Period selector + export -->
	<div class="flex flex-wrap items-center justify-between gap-3">
		<nav class="flex gap-1 rounded-lg border border-border bg-bg p-1" aria-label="Period">
			{#each PERIODS as p (p.key)}
				<a
					href="/finance?period={p.key}"
					class="flex min-h-[44px] items-center rounded-md px-3 text-sm font-medium transition-colors {data.period ===
					p.key
						? 'bg-brand text-white'
						: 'text-muted hover:bg-surface hover:text-ink'}"
					aria-current={data.period === p.key ? 'page' : undefined}
				>
					{p.label}
				</a>
			{/each}
		</nav>

		<a
			href="/finance/export?period={data.period}"
			download
			class="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-border bg-bg px-4 text-sm font-medium text-ink transition-colors hover:bg-surface"
		>
			<Download class="h-4 w-4" aria-hidden="true" />
			Export CSV
		</a>
	</div>

	<!-- KPIs -->
	<section class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
		{#each data.kpis as kpi (kpi.label)}
			<KpiCard {kpi} />
		{/each}
	</section>

	<!-- Revenue + method breakdown -->
	<section class="grid grid-cols-1 gap-4 lg:grid-cols-3">
		<Card class="flex min-h-[260px] flex-col lg:col-span-2">
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

		<Card>
			<SectionHeading title="By payment method" class="mb-4" />
			<DonutChart data={data.breakdown} />
		</Card>
	</section>

	<!-- Transactions -->
	<section class="space-y-2">
		<Table title="Transactions" columns={txCols}>
			{#snippet aside()}
				<span class="text-xs text-muted">
					Showing {data.transactions.length} of {data.total}
				</span>
			{/snippet}
			{#each data.transactions as tx (tx.id)}
				<tr class="transition-colors hover:bg-surface">
					<td class="px-4 py-2.5 whitespace-nowrap text-ink">{fmtDate(tx.createdAt)}</td>
					<td class="px-4 py-2.5">
						<StatusBadge tone={tx.statusTone} label={tx.status.replace('PAYMENT_', '')} />
					</td>
					<td class="px-4 py-2.5 font-mono text-ink">{tx.amount}</td>
					<td class="px-4 py-2.5 text-ink">
						{tx.fundSourceType}{#if tx.fundSourceMasked}<span class="ml-1 font-mono text-xs text-muted"
								>•{tx.fundSourceMasked}</span
							>{/if}
					</td>
					<td class="px-4 py-2.5 text-ink">
						<span class="block truncate">{tx.buyerName}</span>
						{#if tx.buyerEmail}<span class="block truncate text-xs text-muted">{tx.buyerEmail}</span
							>{/if}
					</td>
					<td class="px-4 py-2.5 font-mono text-xs text-muted">{tx.receiptNo ?? '—'}</td>
				</tr>
			{/each}
			{#if data.transactions.length === 0}
				<tr>
					<td colspan={txCols.length} class="px-4 py-8 text-center text-sm text-muted">
						No transactions in this period.
					</td>
				</tr>
			{/if}
		</Table>
		{#if data.total > data.transactions.length}
			<p class="text-xs text-muted">
				{data.total - data.transactions.length} more — narrow the period or export the full CSV.
			</p>
		{/if}
	</section>
</div>
