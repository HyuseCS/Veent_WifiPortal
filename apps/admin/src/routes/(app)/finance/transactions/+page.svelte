<script lang="ts">
	import { navigating, page } from '$app/state';
	import { TransactionsTable } from '$lib/components/feature';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Period change (Topbar) re-runs the load on this same route; skeleton while it resolves.
	const loading = $derived(navigating.to?.url.pathname === page.url.pathname);
</script>

<!-- Full-height column so the table fills the page and its rows scroll internally (sticky
     header), on mobile too (h-full, not md:h-full — the page stays pinned, only the table body
     scrolls). Period filter + Export + back-to-overview live in the Topbar (FinanceHeaderControls). -->
<div class="flex flex-col gap-2 h-full">
	{#if loading}
		<!-- Table silhouette: a toolbar bar + several rows so the period switch paints instantly. -->
		<div class="flex animate-pulse flex-col gap-3 rounded-xl border border-border bg-bg p-4 shadow-sm" aria-hidden="true">
			<div class="h-9 w-full max-w-xs rounded-lg bg-surface"></div>
			{#each Array.from({ length: 8 }, (_, i) => i) as i (i)}
				<div class="h-10 w-full rounded bg-surface"></div>
			{/each}
		</div>
	{:else}
		<TransactionsTable transactions={data.transactions} total={data.total} />
		{#if data.total > data.transactions.length}
			<p class="shrink-0 text-xs text-muted">
				{data.total - data.transactions.length} more — narrow the period or export the full CSV.
			</p>
		{/if}

		<!-- Non-Maya grant AP attribution (credit/points tier buys + free-time grants). Durable
		     circuit-id label survives AP rename/prune. Collapsed by default to keep the payments
		     table the focus. -->
		<details class="shrink-0 rounded-xl border border-border bg-bg shadow-sm">
			<summary class="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">
				Grant attribution — credits, points &amp; free time ({data.grantAttribution.length})
			</summary>
			<div class="overflow-x-auto px-4 pb-4">
				{#if data.grantAttribution.length === 0}
					<p class="py-3 text-xs text-muted">No recent credit, points, or free-time grants.</p>
				{:else}
					<table class="w-full text-left text-sm">
						<thead>
							<tr class="border-b border-border text-[11px] tracking-wider text-muted uppercase">
								<th class="py-2 pr-4">Type</th>
								<th class="py-2 pr-4">Guest</th>
								<th class="py-2 pr-4">Detail</th>
								<th class="py-2 pr-4">Access point</th>
								<th class="py-2">When</th>
							</tr>
						</thead>
						<tbody>
							{#each data.grantAttribution as g (g.kind + g.createdAt + g.who)}
								<tr class="border-b border-border/50">
									<td class="py-2 pr-4 text-ink capitalize">{g.kind.replace('-', ' ')}</td>
									<td class="py-2 pr-4 text-ink">{g.who}</td>
									<td class="py-2 pr-4 text-muted">{g.detail}</td>
									<td class="py-2 pr-4 text-ink" class:text-muted={g.apCircuitLabel === 'Unattributed'}
										>{g.apCircuitLabel}</td
									>
									<td class="py-2 text-xs text-muted">{new Date(g.createdAt).toLocaleString('en-PH')}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>
		</details>
	{/if}
</div>
