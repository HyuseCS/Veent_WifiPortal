<script lang="ts">
	import ArrowDown from 'lucide-svelte/icons/arrow-down';
	import ArrowUp from 'lucide-svelte/icons/arrow-up';
	import BellOff from 'lucide-svelte/icons/bell-off';
	import Check from 'lucide-svelte/icons/check';
	import ChevronsUpDown from 'lucide-svelte/icons/chevrons-up-down';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import ShieldCheck from 'lucide-svelte/icons/shield-check';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import type { Component } from 'svelte';
	import { enhance } from '$app/forms';
	import { EmptyState, IconButton, StatusBadge, Table } from '$lib/components/ui';
	import type { StatusTone } from '$lib/types';
	import type { SentryIssue } from '$lib/server/sentry/types';
	import TableSortControl from '../TableSortControl.svelte';
	import SentryIssueDialog from './SentryIssueDialog.svelte';

	// Issues list. Row actions post to the page's ?/resolve and ?/ignore form actions (the route
	// re-checks active-staff auth and rate-limits); this component is presentation only.
	// `fill`: grow to fill a full-height parent (the dedicated /sentry/issues page) instead of the
	// capped inline height used on the dashboard.
	let {
		issues,
		degraded = false,
		fill = false
	}: { issues: SentryIssue[]; degraded?: boolean; fill?: boolean } = $props();

	type SortKey = 'title' | 'level' | 'count' | 'userCount' | 'lastSeen';
	const columns: { label: string; key?: SortKey; srOnly?: boolean }[] = [
		{ label: 'Issue', key: 'title' },
		{ label: 'Level', key: 'level' },
		{ label: 'Events', key: 'count' },
		{ label: 'Users', key: 'userCount' },
		{ label: 'Last seen', key: 'lastSeen' },
		{ label: 'Actions', srOnly: true }
	];

	// Client-side sort over the already-loaded rows (Sentry ships them frequency-desc). A header
	// click sorts by that column; clicking the same header again flips direction. Text sorts A→Z
	// by default, everything else high→low (most events / most recent first — the triage order).
	let sortKey = $state<SortKey | null>(null);
	let sortDir = $state<'asc' | 'desc'>('desc');

	const levelRank: Record<string, number> = { fatal: 4, error: 3, warning: 2, info: 1, debug: 0 };
	const sortVal = (i: SentryIssue, key: SortKey): string | number => {
		switch (key) {
			case 'title':
				return i.title.toLowerCase();
			case 'level':
				return levelRank[i.level] ?? -1;
			case 'lastSeen':
				return new Date(i.lastSeen).getTime() || 0;
			case 'count':
				return i.count;
			case 'userCount':
				return i.userCount;
		}
	};

	const sorted = $derived.by(() => {
		const key = sortKey;
		if (!key) return issues;
		const dir = sortDir === 'asc' ? 1 : -1;
		return [...issues].sort((a, b) => {
			const av = sortVal(a, key);
			const bv = sortVal(b, key);
			return av < bv ? -dir : av > bv ? dir : 0;
		});
	});

	function toggleSort(key: SortKey) {
		if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else {
			sortKey = key;
			sortDir = key === 'title' ? 'asc' : 'desc';
		}
	}

	// Map Sentry level → badge tone. Errors/fatals read as blocked, warnings as warning, the rest
	// (info/debug) as the calm online tone.
	const levelTone = (level: string): StatusTone =>
		level === 'error' || level === 'fatal' ? 'blocked' : level === 'warning' ? 'warning' : 'online';

	// Same "x ago" formatter the Users table uses (kept local — it isn't exported anywhere).
	function seenAgo(iso: string): string {
		if (!iso) return 'unknown';
		const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
		if (m < 1) return 'just now';
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
	}

	// Row → detail modal. A click anywhere on the row opens it, EXCEPT on the row's own action
	// controls (resolve/ignore/open) — those keep their own behaviour. Keyboard: Enter/Space on the
	// focused row only (not when focus is on a child control).
	let selected = $state<SentryIssue | null>(null);
	let dialogOpen = $state(false);

	function openIssue(issue: SentryIssue) {
		selected = issue;
		dialogOpen = true;
	}
	function onRowClick(issue: SentryIssue, e: MouseEvent) {
		if ((e.target as HTMLElement).closest('a, button')) return;
		openIssue(issue);
	}
	function onRowKey(issue: SentryIssue, e: KeyboardEvent) {
		if (e.target !== e.currentTarget) return;
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			openIssue(issue);
		}
	}
</script>

<Table cards class={fill ? 'min-h-0 flex-1 rounded-none border-0 shadow-none' : 'md:max-h-[75vh]'}>
	{#snippet toolbar()}
		<div class="flex items-center gap-3 px-4 py-3">
			<h2 class="text-base font-semibold text-ink">Unresolved issues</h2>
			{#if sortKey}
				<span class="ml-auto hidden text-xs text-muted md:inline">click a column to re-sort</span>
			{/if}
			<!-- Mobile sort: the sortable <thead> is hidden in card mode, so expose the same keys here. -->
			<div class="ml-auto md:hidden">
				<TableSortControl
					id="sentry-issues-sort"
					label="Sort issues by"
					headers={columns}
					{sortKey}
					{sortDir}
					onToggle={(k) => toggleSort(k as SortKey)}
				/>
			</div>
		</div>
	{/snippet}

	{#snippet footer()}
		<div class="flex items-center gap-3 px-4 py-2 text-xs text-muted">
			<span>
				{issues.length >= 25 ? '25+' : issues.length}
				{issues.length === 1 ? 'unresolved issue' : 'unresolved issues'}
			</span>
			{#if issues.length}
				<span class="ml-auto">Click a row for full error detail</span>
			{/if}
		</div>
	{/snippet}

	{#snippet headRow()}
		<tr class="border-b border-border bg-surface">
			{#each columns as col (col.label)}
				<th
					class="bg-surface px-4 py-1.5 text-left text-[11px] font-semibold tracking-wider text-muted uppercase"
					aria-sort={col.key && sortKey === col.key
						? sortDir === 'asc'
							? 'ascending'
							: 'descending'
						: undefined}
				>
					{#if col.key}
						{@const active = sortKey === col.key}
						<button
							type="button"
							onclick={() => col.key && toggleSort(col.key)}
							class="group inline-flex items-center gap-1 tracking-wider uppercase transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand {active
								? 'text-ink'
								: ''}"
						>
							{col.label}
							{#if active}
								{#if sortDir === 'asc'}
									<ArrowUp class="h-3 w-3" aria-hidden="true" />
								{:else}
									<ArrowDown class="h-3 w-3" aria-hidden="true" />
								{/if}
							{:else}
								<ChevronsUpDown
									class="h-3 w-3 opacity-30 transition-opacity group-hover:opacity-60"
									aria-hidden="true"
								/>
							{/if}
						</button>
					{:else if col.srOnly}
						<span class="sr-only">{col.label}</span>
					{:else}
						{col.label}
					{/if}
				</th>
			{/each}
		</tr>
	{/snippet}

	{#each sorted as issue (issue.id)}
		<tr
			class="cursor-pointer hover:bg-surface focus-visible:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
			role="button"
			tabindex={0}
			aria-label="View details for {issue.shortId || issue.title}"
			onclick={(e) => onRowClick(issue, e)}
			onkeydown={(e) => onRowKey(issue, e)}
		>
			<td class="tc-full px-4 py-3 md:w-full md:max-w-0">
				<div class="min-w-0">
					<div class="truncate font-medium text-ink">{issue.title}</div>
					{#if issue.culprit}
						<div class="truncate font-mono text-xs text-muted">{issue.culprit}</div>
					{/if}
				</div>
			</td>
			<td data-label="Level" class="px-4 py-3">
				<StatusBadge tone={levelTone(issue.level)} label={issue.level} />
			</td>
			<td data-label="Events" class="px-4 py-3 font-mono text-ink">
				{issue.count.toLocaleString('en-US')}
			</td>
			<td data-label="Users" class="px-4 py-3 font-mono text-muted">
				{issue.userCount.toLocaleString('en-US')}
			</td>
			<td data-label="Last seen" class="px-4 py-3 font-mono text-muted">{seenAgo(issue.lastSeen)}</td>
			<td class="tc-full px-4 py-3">
				<div class="flex items-center justify-end gap-1">
					<form method="post" action="?/resolve" use:enhance>
						<input type="hidden" name="id" value={issue.id} />
						<IconButton
							type="submit"
							icon={Check as unknown as Component}
							label="Resolve {issue.shortId || issue.title}"
						/>
					</form>
					<form method="post" action="?/ignore" use:enhance>
						<input type="hidden" name="id" value={issue.id} />
						<IconButton
							type="submit"
							icon={BellOff as unknown as Component}
							label="Ignore {issue.shortId || issue.title}"
						/>
					</form>
					{#if issue.permalink}
						<!-- permalink is an absolute external Sentry issue URL, so resolve() (for
						     app-internal relative paths) doesn't apply here. -->
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						<a
							href={issue.permalink}
							target="_blank"
							rel="noopener noreferrer"
							title="Open in Sentry"
							aria-label="Open {issue.shortId || issue.title} in Sentry"
							class="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
						>
							<ExternalLink class="h-4 w-4" aria-hidden="true" />
						</a>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					{/if}
				</div>
			</td>
		</tr>
	{/each}

	{#if issues.length === 0}
		<tr>
			<td colspan={columns.length} class="tc-full p-0">
				{#if degraded}
					<EmptyState
						icon={TriangleAlert as unknown as Component}
						title="Couldn't reach Sentry"
						description="The issues request failed. Try reloading in a moment."
						compact
					/>
				{:else}
					<EmptyState
						icon={ShieldCheck as unknown as Component}
						title="No unresolved issues"
						description="Nothing needs attention in the last 14 days."
						compact
					/>
				{/if}
			</td>
		</tr>
	{/if}
</Table>

<SentryIssueDialog issue={selected} bind:open={dialogOpen} {levelTone} {seenAgo} />
