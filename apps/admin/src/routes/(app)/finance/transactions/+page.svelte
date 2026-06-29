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
	{/if}
</div>
