<script lang="ts">
	import Search from 'lucide-svelte/icons/search';
	import type { Component } from 'svelte';
	import type { TransactionRow } from '$lib/types';
	import { EmptyState, SearchInput, SortHeader, StatusBadge, Table } from '$lib/components/ui';

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

	// Status is reachable via the sortable Status column, so the filter pills were dropped —
	// this is now a plain text search over the already-loaded rows (no extra loads / DB hits).
	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return transactions;
		return transactions.filter((tx) =>
			`${tx.buyerName} ${tx.buyerEmail ?? ''} ${tx.receiptNo ?? ''}`.toLowerCase().includes(q)
		);
	});

	// Clickable-header sort over the filtered rows. `null` keeps server order (newest first).
	type SortKey = 'date' | 'status' | 'amount' | 'method' | 'buyer' | 'receipt';
	let sortKey = $state<SortKey | null>(null);
	let sortDir = $state<'asc' | 'desc'>('asc');
	const defaultDir: Record<SortKey, 'asc' | 'desc'> = {
		date: 'desc',
		status: 'asc',
		amount: 'desc',
		method: 'asc',
		buyer: 'asc',
		receipt: 'asc'
	};
	function toggleSort(key: SortKey) {
		if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else {
			sortKey = key;
			sortDir = defaultDir[key];
		}
	}
	// Amount is a pre-formatted "₱1,200" string — pull the number out to sort numerically.
	const amountNum = (s: string) => parseFloat(s.replace(/[^0-9.]/g, '')) || 0;

	const sorted = $derived.by(() => {
		if (!sortKey) return filtered;
		const key = sortKey;
		const dir = sortDir === 'asc' ? 1 : -1;
		return [...filtered].sort((a, b) => {
			let cmp = 0;
			if (key === 'date') cmp = a.createdAt.localeCompare(b.createdAt);
			else if (key === 'status') cmp = a.status.localeCompare(b.status);
			else if (key === 'amount') cmp = amountNum(a.amount) - amountNum(b.amount);
			else if (key === 'method') cmp = a.fundSourceType.localeCompare(b.fundSourceType);
			else if (key === 'buyer') cmp = a.buyerName.localeCompare(b.buyerName);
			else cmp = (a.receiptNo ?? '').localeCompare(b.receiptNo ?? ''); // receipt
			return cmp * dir;
		});
	});

	const columns: { label: string; key: SortKey }[] = [
		{ label: 'Date', key: 'date' },
		{ label: 'Status', key: 'status' },
		{ label: 'Amount', key: 'amount' },
		{ label: 'Method', key: 'method' },
		{ label: 'Buyer', key: 'buyer' },
		{ label: 'Receipt', key: 'receipt' }
	];

	const dateFmt = new Intl.DateTimeFormat('en-PH', {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
	const fmtDate = (iso: string) => dateFmt.format(new Date(iso));
</script>

<!-- Fill the parent's height so the rows scroll inside (sticky header) instead of growing the
     page; the finance page gives this a full-viewport-tall flex column. -->
<Table class="min-h-0 flex-1">
	<!-- Toolbar: search + status filter, matching the Users table chrome exactly. -->
	{#snippet toolbar()}
		<div class="flex flex-wrap items-center gap-3 px-4 py-3">
			<h2 class="text-base font-semibold text-ink">Transactions</h2>
			<SearchInput
				bind:value={query}
				placeholder="Search buyer or receipt…"
				label="Search transactions"
				class="ml-auto min-w-60 flex-1 sm:max-w-xs"
			/>
		</div>
	{/snippet}

	<!-- Clickable, sortable column headers (replaces the static `columns` header row). -->
	{#snippet headRow()}
		<tr class="border-b border-border bg-surface">
			{#each columns as col (col.key)}
				<SortHeader
					label={col.label}
					active={sortKey === col.key}
					dir={sortDir}
					onsort={() => toggleSort(col.key)}
				/>
			{/each}
		</tr>
	{/snippet}

	{#each sorted as tx (tx.id)}
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
