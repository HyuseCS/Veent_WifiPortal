<script lang="ts">
	import { TransactionsTable } from '$lib/components/feature';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<!-- Full-height column so the table fills the page and its rows scroll internally (sticky
     header). Period filter + Export + back-to-overview live in the Topbar (FinanceHeaderControls). -->
<div class="flex flex-col gap-2 md:h-full">
	<TransactionsTable transactions={data.transactions} total={data.total} />
	{#if data.total > data.transactions.length}
		<p class="shrink-0 text-xs text-muted">
			{data.total - data.transactions.length} more — narrow the period or export the full CSV.
		</p>
	{/if}
</div>
