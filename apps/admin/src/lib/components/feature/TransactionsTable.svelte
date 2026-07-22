<script lang="ts">
	import Search from 'lucide-svelte/icons/search';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ChevronUp from 'lucide-svelte/icons/chevron-up';
	import ChevronsUpDown from 'lucide-svelte/icons/chevrons-up-down';
	import type { Component } from 'svelte';
	import type { UnifiedTransactionRow, StatusTone } from '$lib/types';
	import { createSort } from '$lib/sortable.svelte';
	import { EmptyState, SearchInput, StatusBadge, Table } from '$lib/components/ui';
	import TableSortControl from './TableSortControl.svelte';

	// The Finance transactions panel. Mirrors <UsersTable>: client-side search + clickable-header
	// sort run purely over the already-loaded `transactions` (no extra loads / DB hits), composed
	// through <Table>'s toolbar/footer snippets so the table chrome stays shared. Rows are the
	// unified activity superset (Maya payments + credit/points/free-time events), so Maya-only
	// fields (status/method/receipt/email) are null on non-Maya kinds and render "n/a". `total` is
	// the server-side match count; `transactions` is the first page already fetched in the load.
	let { transactions, total }: { transactions: UnifiedTransactionRow[]; total: number } = $props();

	// Human label for a raw gateway status, e.g. "PAYMENT_SUCCESS" → "Success".
	const cleanStatus = (status: string) => {
		const s = status
			.replace(/^PAYMENT_/, '')
			.replace(/_/g, ' ')
			.toLowerCase();
		return s.charAt(0).toUpperCase() + s.slice(1);
	};

	// Human label per activity kind (AC2 — every row is clearly typed).
	const kindLabel: Record<UnifiedTransactionRow['kind'], string> = {
		'maya-payment': 'Maya payment',
		'credit-topup': 'Credit top-up',
		'credit-spend': 'Credit spend',
		'points-spend': 'Points spent',
		'free-time': 'Free time'
	};

	let query = $state('');

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return transactions;
		return transactions.filter((tx) =>
			`${tx.who} ${tx.buyerEmail ?? ''} ${tx.receiptNo ?? ''} ${tx.apCircuitLabel} ${kindLabel[tx.kind]}`
				.toLowerCase()
				.includes(q)
		);
	});

	// Clickable-header sorting (shared $lib/sortable). `null` key keeps the server order.
	type SortKey = 'date' | 'kind' | 'status' | 'amount' | 'method' | 'buyer' | 'apName' | 'receipt';
	// Logical status order via tone (online/success → warning → blocked), not alphabetical.
	const toneRank: Record<StatusTone, number> = { online: 0, warning: 1, blocked: 2 };
	// `amount` is a pre-formatted peso string ("₱1,200") — parse digits back for numeric sort.
	const amountNum = (a: string) => Number(a.replace(/[^\d.]/g, '')) || 0;
	// First-click direction per column (e.g. newest / biggest first).
	const sort = createSort<SortKey>({
		date: 'desc',
		kind: 'asc',
		status: 'asc',
		amount: 'desc',
		method: 'asc',
		buyer: 'asc',
		apName: 'asc',
		receipt: 'asc'
	});

	// Null-guard every comparator: amount/status/statusTone/fundSourceType are null on non-Maya /
	// non-money kinds — an unguarded .localeCompare / array-index on null throws at click time and
	// crashes the sort (browser-visible).
	const sorted = $derived(
		sort.apply(filtered, (a, b, key) => {
			if (key === 'date') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
			if (key === 'kind') return kindLabel[a.kind].localeCompare(kindLabel[b.kind]);
			if (key === 'status')
				return (
					(a.statusTone ? toneRank[a.statusTone] : -1) -
					(b.statusTone ? toneRank[b.statusTone] : -1)
				);
			if (key === 'amount')
				return (a.amount ? amountNum(a.amount) : 0) - (b.amount ? amountNum(b.amount) : 0);
			if (key === 'method') return (a.fundSourceType ?? '').localeCompare(b.fundSourceType ?? '');
			if (key === 'buyer') return a.who.localeCompare(b.who);
			if (key === 'apName') return a.apCircuitLabel.localeCompare(b.apCircuitLabel);
			return (a.receiptNo ?? '').localeCompare(b.receiptNo ?? ''); // receipt
		})
	);

	// Header config: `key` makes a column a clickable sort toggle.
	const headers: { label: string; key: SortKey }[] = [
		{ label: 'Date', key: 'date' },
		{ label: 'Type', key: 'kind' },
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
<Table cards class="min-h-0 flex-1">
	<!-- Toolbar: title + search, matching the Users table chrome (status filter pills dropped —
	     status is now a sortable column). -->
	{#snippet toolbar()}
		<div class="flex flex-wrap items-center gap-3 px-4 py-3">
			<h2 class="text-base font-semibold text-ink">Transactions</h2>
			<SearchInput
				bind:value={query}
				placeholder="Search buyer or receipt…"
				label="Search transactions"
				class="ml-auto min-w-0 flex-1 sm:max-w-xs"
			/>
			<!-- Mobile sort: the sortable <thead> is hidden in card mode, so expose the same
			     keys here. md:hidden — desktop keeps the clickable headers. -->
			<TableSortControl
				id="tx-sort"
				label="Sort transactions by"
				{headers}
				sortKey={sort.key}
				sortDir={sort.dir}
				onToggle={(k) => sort.toggle(k as SortKey)}
			/>
		</div>
	{/snippet}

	<!-- Custom header row: clickable, sortable column headers (mirrors <UsersTable>). -->
	{#snippet headRow()}
		<tr class="border-b border-border bg-surface">
			{#each headers as h (h.label)}
				<th
					class="px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-muted uppercase"
					aria-sort={sort.key === h.key
						? sort.dir === 'asc'
							? 'ascending'
							: 'descending'
						: undefined}
				>
					<button
						type="button"
						onclick={() => sort.toggle(h.key)}
						class="group inline-flex items-center gap-1 tracking-wider uppercase transition-colors hover:text-ink {sort.key ===
						h.key
							? 'text-ink'
							: ''}"
					>
						{h.label}
						{#if sort.key === h.key}
							{#if sort.dir === 'asc'}
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
			<td data-label="Date" class="px-4 py-2.5 whitespace-nowrap text-ink"
				>{fmtDate(tx.createdAt)}</td
			>
			<td data-label="Type" class="px-4 py-2.5 whitespace-nowrap text-ink">{kindLabel[tx.kind]}</td>
			<td data-label="Status" class="px-4 py-2.5">
				{#if tx.status && tx.statusTone}
					<StatusBadge tone={tx.statusTone} label={cleanStatus(tx.status)} />
				{:else}
					<span class="text-xs text-muted">n/a</span>
				{/if}
			</td>
			<td data-label="Amount" class="px-4 py-2.5 font-mono font-semibold text-ink max-sm:text-base">
				{tx.amount ?? tx.detail}{#if tx.pointsEarned}<span
						class="ml-1.5 rounded bg-surface px-1.5 py-0.5 font-sans text-[11px] font-medium text-muted"
						>+{tx.pointsEarned} pts</span
					>{/if}
			</td>
			<td data-label="Method" class="px-4 py-2.5 text-ink">
				{#if tx.fundSourceType}{tx.fundSourceType}{#if tx.fundSourceMasked}<span
							class="ml-1 font-mono text-xs text-muted">•{tx.fundSourceMasked}</span
						>{/if}{:else}<span class="text-xs text-muted">n/a</span>{/if}
			</td>
			<td data-label="Buyer" class="px-4 py-2.5 text-ink tc-full">
				<span class="block min-w-0 truncate max-sm:text-base">{tx.who}</span>
				{#if tx.buyerEmail}<span class="block min-w-0 truncate text-xs text-muted"
						>{tx.buyerEmail}</span
					>{/if}
			</td>
			<td
				data-label="Access point"
				class="px-4 py-2.5 text-ink"
				class:tc-skip={tx.apCircuitLabel === 'Unattributed'}>{tx.apCircuitLabel}</td
			>
			<td
				data-label="Receipt"
				class="px-4 py-2.5 font-mono text-xs text-muted"
				class:tc-skip={!tx.receiptNo}>{tx.receiptNo ?? 'n/a'}</td
			>
		</tr>
	{/each}

	{#if filtered.length === 0}
		<tr>
			<td colspan={headers.length} class="tc-full p-0">
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
