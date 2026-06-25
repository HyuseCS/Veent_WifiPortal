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
				`${tx.buyerName} ${tx.buyerEmail ?? ''} ${tx.receiptNo ?? ''} ${tx.apName ?? ''}`
					.toLowerCase()
					.includes(q)
			);
		}
		return rows;
	});

	const columns = [
		{ label: 'Date' },
		{ label: 'Status' },
		{ label: 'Amount' },
		{ label: 'Method' },
		{ label: 'Buyer' },
		{ label: 'Access point' },
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

<Table {columns}>
	<!-- Toolbar: search + status filter, matching the Users table chrome exactly. -->
	{#snippet toolbar()}
		<div class="flex flex-wrap items-center gap-3 px-4 py-3">
			<h2 class="text-base font-semibold text-ink">Transactions</h2>
			<FilterTabs {tabs} active={filter} onselect={(key) => (filter = key)} />
			<SearchInput
				bind:value={query}
				placeholder="Search buyer or receipt…"
				label="Search transactions"
				class="ml-auto min-w-60 flex-1 sm:max-w-xs"
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
			<td class="px-4 py-2.5 text-ink">{tx.apName ?? '—'}</td>
			<td class="px-4 py-2.5 font-mono text-xs text-muted">{tx.receiptNo ?? '—'}</td>
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

	<!-- Footer: how many of the server-matched total are on this page. -->
	{#snippet footer()}
		<p class="px-4 py-3 text-xs text-muted">
			Showing {filtered.length} of {total} transactions
		</p>
	{/snippet}
</Table>
