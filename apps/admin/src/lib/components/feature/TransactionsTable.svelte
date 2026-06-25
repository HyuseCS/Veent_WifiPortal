<script lang="ts">
	import Search from 'lucide-svelte/icons/search';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ChevronUp from 'lucide-svelte/icons/chevron-up';
	import ChevronsUpDown from 'lucide-svelte/icons/chevrons-up-down';
	import type { Component } from 'svelte';
	import type { TransactionRow, StatusTone } from '$lib/types';
	import { EmptyState, SearchInput, StatusBadge, Table } from '$lib/components/ui';

	// The Finance transactions panel. Mirrors <UsersTable>: client-side search + clickable-header
	// sort run purely over the already-loaded `transactions` (no extra loads / DB hits), composed
	// through <Table>'s toolbar/footer snippets so the table chrome stays shared. Status is
	// reachable via the Status column sorter, so the old status-filter pills were dropped (mirrors
	// <UsersTable>). `total` is the server-side match count (for the "showing X of Y" footer /
	// pagination hint); `transactions` is the first page already fetched in the page load.
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

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return transactions;
		return transactions.filter((tx) =>
			`${tx.buyerName} ${tx.buyerEmail ?? ''} ${tx.receiptNo ?? ''} ${tx.apName ?? ''}`
				.toLowerCase()
				.includes(q)
		);
	});

	// Clickable-header sorting (mirrors <UsersTable>). `null` key keeps the server order.
	type SortKey = 'date' | 'status' | 'amount' | 'method' | 'buyer' | 'apName' | 'receipt';
	let sortKey = $state<SortKey | null>(null);
	let sortDir = $state<'asc' | 'desc'>('asc');
	// Sensible first-click direction per column (e.g. newest / biggest first).
	const defaultDir: Record<SortKey, 'asc' | 'desc'> = {
		date: 'desc',
		status: 'asc',
		amount: 'desc',
		method: 'asc',
		buyer: 'asc',
		apName: 'asc',
		receipt: 'asc'
	};
	// Logical status order via tone (online/success → warning → blocked), not alphabetical.
	const toneRank: Record<StatusTone, number> = { online: 0, warning: 1, blocked: 2 };
	// `amount` is a pre-formatted peso string ("₱1,200") — parse digits back for numeric sort.
	const amountNum = (a: string) => Number(a.replace(/[^\d.]/g, '')) || 0;

	function toggleSort(key: SortKey) {
		if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else {
			sortKey = key;
			sortDir = defaultDir[key];
		}
	}

	const sorted = $derived.by(() => {
		if (!sortKey) return filtered;
		const key = sortKey;
		const dir = sortDir === 'asc' ? 1 : -1;
		return [...filtered].sort((a, b) => {
			let cmp: number;
			if (key === 'date') cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
			else if (key === 'status') cmp = toneRank[a.statusTone] - toneRank[b.statusTone];
			else if (key === 'amount') cmp = amountNum(a.amount) - amountNum(b.amount);
			else if (key === 'method') cmp = a.fundSourceType.localeCompare(b.fundSourceType);
			else if (key === 'buyer') cmp = a.buyerName.localeCompare(b.buyerName);
			else if (key === 'apName') cmp = (a.apName ?? '').localeCompare(b.apName ?? '');
			else cmp = (a.receiptNo ?? '').localeCompare(b.receiptNo ?? ''); // receipt
			return cmp * dir;
		});
	});

	// Header config: `key` makes a column a clickable sort toggle.
	const headers: { label: string; key: SortKey }[] = [
		{ label: 'Date', key: 'date' },
		{ label: 'Status', key: 'status' },
		{ label: 'Amount', key: 'amount' },
		{ label: 'Method', key: 'method' },
		{ label: 'Buyer', key: 'buyer' },
		{ label: 'Access point', key: 'apName' },
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
	<!-- Toolbar: title + search, matching the Users table chrome (status filter pills dropped —
	     status is now a sortable column). -->
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

	<!-- Custom header row: clickable, sortable column headers (mirrors <UsersTable>). -->
	{#snippet headRow()}
		<tr class="border-b border-border bg-surface">
			{#each headers as h (h.label)}
				<th
					class="px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-muted uppercase"
					aria-sort={sortKey === h.key
						? sortDir === 'asc'
							? 'ascending'
							: 'descending'
						: undefined}
				>
					<button
						type="button"
						onclick={() => toggleSort(h.key)}
						class="group inline-flex items-center gap-1 tracking-wider uppercase transition-colors hover:text-ink {sortKey ===
						h.key
							? 'text-ink'
							: ''}"
					>
						{h.label}
						{#if sortKey === h.key}
							{#if sortDir === 'asc'}
								<ChevronUp class="h-3.5 w-3.5" aria-hidden="true" />
							{:else}
								<ChevronDown class="h-3.5 w-3.5" aria-hidden="true" />
							{/if}
						{:else}
							<ChevronsUpDown
								class="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-50"
								aria-hidden="true"
							/>
						{/if}
					</button>
				</th>
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
			<td class="px-4 py-2.5 text-ink">{tx.apName ?? '—'}</td>
			<td class="px-4 py-2.5 font-mono text-xs text-muted">{tx.receiptNo ?? '—'}</td>
		</tr>
	{/each}

	{#if filtered.length === 0}
		<tr>
			<td colspan={headers.length} class="p-0">
				<EmptyState
					icon={Search as unknown as Component}
					title="No transactions match"
					description="Try a different search term."
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
