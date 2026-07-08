<script lang="ts">
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import Check from 'lucide-svelte/icons/check';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import SearchX from 'lucide-svelte/icons/search-x';
	import ShieldCheck from 'lucide-svelte/icons/shield-check';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import type { Component } from 'svelte';
	import { EmptyState, SearchInput, StatusBadge, Table } from '$lib/components/ui';
	import type { StatusTone } from '$lib/types';
	import type { SentryIssue } from '$lib/server/sentry/types';
	import SentryErrorDetail from './SentryErrorDetail.svelte';

	// Full-bleed in-modal "page" for picking a Sentry error to track as an incident (the parent
	// drops the dialog padding so this fills the panel). Same unresolved-issue list the /sentry table
	// shows, minus the triage actions (resolve/ignore/open) — the only per-row control is a chevron
	// that expands the row to reveal the full error detail (SentryErrorDetail, which self-fetches the
	// latest event). Clicking the row body selects it and calls `onselect`.
	let {
		issues,
		degraded = false,
		selectedId = null,
		onselect,
		onback
	}: {
		issues: SentryIssue[];
		degraded?: boolean;
		selectedId?: string | null;
		onselect: (issue: SentryIssue) => void;
		onback: () => void;
	} = $props();

	const columns: { label: string; srOnly?: boolean }[] = [
		{ label: 'Issue' },
		{ label: 'Level' },
		{ label: 'Events' },
		{ label: 'Last seen' },
		{ label: 'Expand', srOnly: true }
	];

	// Free-text filter over the loaded rows (title / short id / culprit) — client-side, no reload.
	let query = $state('');
	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return issues;
		return issues.filter(
			(i) =>
				i.title.toLowerCase().includes(q) ||
				i.shortId.toLowerCase().includes(q) ||
				i.culprit.toLowerCase().includes(q)
		);
	});

	// Errors/fatals read as blocked, warnings as warning, the rest (info/debug) as the calm tone.
	const levelTone = (level: string): StatusTone =>
		level === 'error' || level === 'fatal' ? 'blocked' : level === 'warning' ? 'warning' : 'online';

	// Same "x ago" formatter the Sentry/Users tables use (kept local — not exported anywhere).
	function seenAgo(iso: string): string {
		if (!iso) return 'unknown';
		const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
		if (m < 1) return 'just now';
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
	}

	// Single-open accordion — expanding one row collapses any other (one detail fetch at a time).
	let expandedId = $state<string | null>(null);
	const toggleExpand = (id: string) => (expandedId = expandedId === id ? null : id);

	function onRowClick(issue: SentryIssue, e: MouseEvent) {
		if ((e.target as HTMLElement).closest('button')) return; // let the chevron do its own thing
		onselect(issue);
	}
	function onRowKey(issue: SentryIssue, e: KeyboardEvent) {
		if (e.target !== e.currentTarget) return;
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onselect(issue);
		}
	}
</script>

<!-- Fills the (unpadded) dialog; the shell drops its own border/rounding so the panel frames it. -->
<div class="flex h-[82vh] flex-col">
	<Table cards class="min-h-0 flex-1 rounded-none border-0 shadow-none">
		{#snippet toolbar()}
			<div class="flex flex-col gap-3 px-4 py-3">
				<div class="flex items-center gap-2">
					<button
						type="button"
						onclick={onback}
						class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
						aria-label="Back to the incident form"
					>
						<ArrowLeft class="h-4 w-4" aria-hidden="true" />
					</button>
					<h2 class="text-base font-semibold text-ink">Select a Sentry issue</h2>
				</div>
				<SearchInput
					bind:value={query}
					label="Search Sentry issues"
					placeholder="Search by title, short id, or file…"
				/>
			</div>
		{/snippet}

		{#snippet footer()}
			<div class="px-4 py-2 text-xs text-muted">
				Pick a row to track it as an incident · use the arrow to inspect the error first
			</div>
		{/snippet}

		{#each filtered as issue (issue.id)}
			{@const expanded = expandedId === issue.id}
			<tr
				class="cursor-pointer hover:bg-surface focus-visible:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand {selectedId ===
				issue.id
					? 'bg-brand/5'
					: ''}"
				role="button"
				tabindex={0}
				aria-label="Select {issue.shortId || issue.title}"
				onclick={(e) => onRowClick(issue, e)}
				onkeydown={(e) => onRowKey(issue, e)}
			>
				<td class="tc-full px-4 py-3 md:w-full md:max-w-0">
					<div class="flex min-w-0 items-center gap-2">
						{#if selectedId === issue.id}
							<Check class="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
						{/if}
						<div class="min-w-0">
							<div class="truncate font-medium text-ink">{issue.title}</div>
							{#if issue.culprit}
								<div class="truncate font-mono text-xs text-muted">{issue.culprit}</div>
							{/if}
						</div>
					</div>
				</td>
				<td data-label="Level" class="px-4 py-3">
					<StatusBadge tone={levelTone(issue.level)} label={issue.level} />
				</td>
				<td data-label="Events" class="px-4 py-3 font-mono text-ink">
					{issue.count.toLocaleString('en-US')}
				</td>
				<td data-label="Last seen" class="px-4 py-3 font-mono text-muted">{seenAgo(issue.lastSeen)}</td>
				<td class="tc-full px-4 py-3">
					<div class="flex justify-end">
						<button
							type="button"
							onclick={() => toggleExpand(issue.id)}
							aria-expanded={expanded}
							aria-label={expanded
								? `Hide detail for ${issue.shortId || issue.title}`
								: `Show detail for ${issue.shortId || issue.title}`}
							class="flex h-11 w-11 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
						>
							<ChevronDown
								class="h-4 w-4 transition-transform duration-150 {expanded ? 'rotate-180' : ''}"
								aria-hidden="true"
							/>
						</button>
					</div>
				</td>
			</tr>
			{#if expanded}
				<tr>
					<td colspan={columns.length} class="tc-full bg-surface/40 px-4 py-4">
						<div class="space-y-4">
							<SentryErrorDetail {issue} {seenAgo} />
						</div>
					</td>
				</tr>
			{/if}
		{/each}

		{#if issues.length === 0}
			<tr>
				<td colspan={columns.length} class="tc-full p-0">
					{#if degraded}
						<EmptyState
							icon={TriangleAlert as unknown as Component}
							title="Couldn't reach Sentry"
							description="The issues request failed. Close and try again in a moment."
							compact
						/>
					{:else}
						<EmptyState
							icon={ShieldCheck as unknown as Component}
							title="No unresolved issues"
							description="There's nothing in the Sentry feed to track right now."
							compact
						/>
					{/if}
				</td>
			</tr>
		{:else if filtered.length === 0}
			<tr>
				<td colspan={columns.length} class="tc-full p-0">
					<EmptyState
						icon={SearchX as unknown as Component}
						title="No matching issues"
						description="No unresolved issue matches “{query}”."
						compact
					/>
				</td>
			</tr>
		{/if}
	</Table>
</div>
