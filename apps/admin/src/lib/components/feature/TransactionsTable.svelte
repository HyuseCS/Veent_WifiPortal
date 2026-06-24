<script lang="ts">
	import Search from 'lucide-svelte/icons/search';
	import type { Component } from 'svelte';
	import type { TransactionRow } from '$lib/types';
	import { EmptyState, FilterTabs, SearchInput, StatusBadge, Table } from '$lib/components/ui';

	// The Finance transactions panel. Mirrors <UsersTable>: client-side search + status
	// filter run purely over the already-loaded `transactions` (no extra loads / DB hits),
	// composed through <Table>'s toolbar/footer snippets so the table chrome stays shared.
	// `total` is the server-side match count (for the "showing X of Y" footer / pagination
	// hint); `transactions` is the first page already fetched in the page load.
	let { transactions, total }: { transactions: TransactionRow[]; total: number } = $props();

	// Human label for a raw gateway status, e.g. "PAYMENT_SUCCESS" → "Success".
	const cleanStatus = (status: string) => {
		const s = status
			.replace(/^PAYMENT_/, '')
			.replace(/_/g, ' ')
			.toLowerCase();
		return s.charAt(0).toUpperCase() + s.slice(1);
	};

	let query = $state('');
	let filter = $state<string>('all');

	// Status filter pills with live counts off the full set (counts stay stable as you filter).
	// Tabs are derived from the statuses actually present — no fabricated buckets.
	const tabs = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const tx of transactions) counts[tx.status] = (counts[tx.status] ?? 0) + 1;
		return [
			{ key: 'all', label: 'All', count: transactions.length },
			...Object.entries(counts).map(([status, count]) => ({
				key: status,
				label: cleanStatus(status),
				count
			}))
		];
	});

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		let rows = transactions.filter((tx) => filter === 'all' || tx.status === filter);
		if (q) {
			rows = rows.filter((tx) =>
				`${tx.buyerName} ${tx.buyerEmail ?? ''} ${tx.receiptNo ?? ''}`.toLowerCase().includes(q)
			);
		}
		return rows;
	});

	// Receipt hidden on tablet (sm–lg), visible at desktop (lg+).
	const columns = [
		{ label: 'Date' },
		{ label: 'Status' },
		{ label: 'Amount' },
		{ label: 'Method' },
		{ label: 'Buyer' },
		{ label: 'Receipt', class: 'hidden lg:table-cell' }
	];

	const dateFmt = new Intl.DateTimeFormat('en-PH', {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
	const fmtDate = (iso: string) => dateFmt.format(new Date(iso));
</script>

<!-- Mobile: stacked card list (hidden at sm+) -->
<div class="flex flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-sm sm:hidden">
	<div class="border-b border-border">
		<div class="flex flex-col gap-2 px-4 py-3">
			<h2 class="text-sm font-semibold text-ink">Transactions</h2>
			<SearchInput
				bind:value={query}
				placeholder="Search buyer or receipt…"
				label="Search transactions"
				class="w-full"
			/>
			<FilterTabs {tabs} active={filter} onselect={(key) => (filter = key)} fill />
		</div>
	</div>

	<div class="divide-y divide-border">
		{#each filtered as tx (tx.id)}
			<div class="px-4 py-3 transition-colors duration-150 hover:bg-surface">
				<div class="flex items-start justify-between gap-2">
					<div class="min-w-0">
						<p class="truncate font-medium text-ink">{tx.buyerName}</p>
						{#if tx.buyerEmail}
							<p class="truncate text-xs text-muted">{tx.buyerEmail}</p>
						{/if}
					</div>
					<StatusBadge tone={tx.statusTone} label={cleanStatus(tx.status)} />
				</div>
				<div class="mt-1.5 flex items-center justify-between gap-3">
					<div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
						<span class="whitespace-nowrap">{fmtDate(tx.createdAt)}</span>
						<span
							>{tx.fundSourceType}{#if tx.fundSourceMasked}&nbsp;•{tx.fundSourceMasked}{/if}</span
						>
						{#if tx.receiptNo}
							<span class="font-mono">{tx.receiptNo}</span>
						{/if}
					</div>
					<span class="shrink-0 font-mono text-sm font-semibold text-ink">{tx.amount}</span>
				</div>
			</div>
		{/each}

		{#if filtered.length === 0}
			<EmptyState
				icon={Search as unknown as Component}
				title="No transactions match"
				description="Try a different search term or status filter."
				compact
			/>
		{/if}
	</div>

	<div class="border-t border-border">
		<p class="px-4 py-3 text-xs text-muted">Showing {filtered.length} of {total} transactions</p>
	</div>
</div>

<!-- Tablet+: full table (hidden below sm) -->
<div class="hidden sm:block">
	<Table {columns} scrollX>
		{#snippet toolbar()}
			<div class="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center">
				<h2 class="shrink-0 text-base font-semibold text-ink">Transactions</h2>
				<FilterTabs
					{tabs}
					active={filter}
					onselect={(key) => (filter = key)}
					class="flex-wrap"
				/>
				<SearchInput
					bind:value={query}
					placeholder="Search buyer or receipt…"
					label="Search transactions"
					class="w-full md:ml-auto md:max-w-xs"
				/>
			</div>
		{/snippet}

		{#each filtered as tx (tx.id)}
			<tr class="hover:bg-surface">
				<td class="px-4 py-2.5 whitespace-nowrap text-ink">{fmtDate(tx.createdAt)}</td>
				<td class="px-4 py-2.5">
					<StatusBadge tone={tx.statusTone} label={cleanStatus(tx.status)} />
				</td>
				<td class="px-4 py-2.5 font-mono font-semibold text-ink">{tx.amount}</td>
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
				<td class="hidden px-4 py-2.5 font-mono text-xs text-muted lg:table-cell"
					>{tx.receiptNo ?? '—'}</td
				>
			</tr>
		{/each}

		{#if filtered.length === 0}
			<tr>
				<td colspan={columns.length} class="p-0">
					<EmptyState
						icon={Search as unknown as Component}
						title="No transactions match"
						description="Try a different search term or status filter."
						compact
					/>
				</td>
			</tr>
		{/if}

		{#snippet footer()}
			<p class="px-4 py-3 text-xs text-muted">
				Showing {filtered.length} of {total} transactions
			</p>
		{/snippet}
	</Table>
</div>
