<script lang="ts">
	import ClipboardCheck from 'lucide-svelte/icons/clipboard-check';
	import Plus from 'lucide-svelte/icons/plus';
	import type { Component } from 'svelte';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button, EmptyState, FilterTabs, StatusBadge } from '$lib/components/ui';
	import IssueDetailModal from './IssueDetailModal.svelte';
	import IssueForm from './IssueForm.svelte';
	import type { AdminIssueRow } from '$lib/server/issues';

	// Assignee view. Two datasets share one tabbed list: MY incidents (assigned to me) and the shared
	// "Open" pool (unassigned incidents any staff member can take). A pool card opens a quick preview
	// modal with a Take button (self-assign, posts ?/take); a "mine" card still opens the full
	// /issues/[id] page, where the status form + comment composer live. Filtering/sorting is
	// client-side over the already-loaded rows.
	//
	// The grid's first cell is a permanent "Report an issue" tile — any signed-in staff member (not
	// just owner/system_admin) can flag something they noticed. It reuses the manager IssueForm with
	// `canAssign={false}` (no assignee fieldset) and posts to ?/selfReport, which always creates the
	// incident unassigned into the same Open pool above. The tile is the grid's first cell on every
	// tab and in every state (even zero issues + an empty pool), so reporting is never gated behind
	// having something else to look at.
	let {
		issues,
		pool,
		networks
	}: {
		issues: AdminIssueRow[];
		pool: AdminIssueRow[];
		networks: { id: string; name: string }[];
	} = $props();

	const icon = (c: unknown) => c as Component;

	// Per-issue selected status (drives whether the resolution-note field shows) + per-issue error,
	// plus the id currently submitting (shared by the status form and the Take button — never both).
	let draft = $state<Record<number, string>>({});
	let errors = $state<Record<number, string>>({});
	let submittingId = $state<number | null>(null);

	const statusOf = (i: AdminIssueRow) => draft[i.id] ?? i.status;

	const statusOptions = [
		{ value: 'open', label: 'Open' },
		{ value: 'in_progress', label: 'In Progress' },
		{ value: 'resolved', label: 'Resolved' }
	];

	const due = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString() : '—');
	const isOverdue = (i: AdminIssueRow) =>
		i.dueDate != null && i.status !== 'resolved' && i.dueDate < Date.now();

	// A pool card (not yet anyone's) opens a quick-preview modal with just a Take button; a "mine"
	// card still opens the full /issues/[id] page (its status form + comment composer live there).
	// Both are guarded so clicks on a nested control (the title itself, the status form, Take) don't
	// also fire the card-wide handler — same closest() guard IssuesTable uses for its row-wide click.
	let modalOpen = $state(false);
	let modalIssueId = $state<number | null>(null);
	const modalIssue = $derived(
		modalIssueId == null ? null : (pool.find((i) => i.id === modalIssueId) ?? null)
	);
	function openModal(issue: AdminIssueRow) {
		modalIssueId = issue.id;
		modalOpen = true;
	}
	function onCardClick(e: MouseEvent, issue: AdminIssueRow) {
		if ((e.target as HTMLElement).closest('a, button, select, input, form, label')) return;
		if (isPool) openModal(issue);
		else goto(resolve(`/issues/${issue.id}`));
	}

	// "Report an issue" — the self-report create modal, open to any signed-in staff.
	let reportOpen = $state(false);

	// Two-level filter. Parent picks the dataset: the shared "Open" pool (unassigned, up for grabs)
	// vs "My Issues" (assigned to me). Only "My Issues" has children — which status of my own work.
	type ParentFilter = 'open' | 'mine';
	let parentFilter = $state<ParentFilter>('mine');

	type ChildFilter = 'assigned' | 'in_progress' | 'resolved';
	let childFilter = $state<ChildFilter>('assigned');

	const counts = $derived({
		open: issues.filter((i) => i.status === 'open').length,
		in_progress: issues.filter((i) => i.status === 'in_progress').length,
		resolved: issues.filter((i) => i.status === 'resolved').length
	});
	const overdueCount = $derived(issues.filter(isOverdue).length);

	// Prioritised order: unresolved before resolved → overdue first → soonest due (nulls last) →
	// higher priority.
	const priorityRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
	function cmp(a: AdminIssueRow, b: AdminIssueRow): number {
		const aResolved = a.status === 'resolved' ? 1 : 0;
		const bResolved = b.status === 'resolved' ? 1 : 0;
		if (aResolved !== bResolved) return aResolved - bResolved;
		const aOverdue = isOverdue(a) ? 0 : 1;
		const bOverdue = isOverdue(b) ? 0 : 1;
		if (aOverdue !== bOverdue) return aOverdue - bOverdue;
		const aDue = a.dueDate ?? Infinity;
		const bDue = b.dueDate ?? Infinity;
		if (aDue !== bDue) return aDue - bDue;
		return (priorityRank[b.priority] ?? 0) - (priorityRank[a.priority] ?? 0);
	}

	// "Open" draws from the shared pool; "My Issues" filters my own incidents by the child status
	// ('assigned' means my open — not-yet-started — incidents, matching the derived "Assigned" badge).
	const isPool = $derived(parentFilter === 'open');
	const visible = $derived.by(() => {
		if (parentFilter === 'open') return [...pool].sort(cmp);
		const mine = issues.filter((i) =>
			childFilter === 'assigned' ? i.status === 'open' : i.status === childFilter
		);
		return [...mine].sort(cmp);
	});

	const childLabel: Record<ChildFilter, string> = {
		assigned: 'assigned',
		in_progress: 'in-progress',
		resolved: 'resolved'
	};
</script>

<div class="flex min-h-full flex-col gap-4">
	<!-- Section header, one line: the Topbar owns the page <h1> ("Incidents"), so this <h2> is
	     sr-only — the parent filter (Open vs My Issues) sits left, the child status filter (My
	     Issues only) sits right, where the old single filter row was. -->
	<h2 class="sr-only">Incidents</h2>
	<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
		<div class="flex items-center gap-2">
			<FilterTabs
				tabs={[
					{ key: 'open', label: 'Open', count: pool.length },
					{ key: 'mine', label: 'My Issues', count: issues.length }
				]}
				active={parentFilter}
				onselect={(k) => (parentFilter = k)}
				class="w-max"
			/>
			{#if !isPool && overdueCount}
				<span class="text-sm font-medium text-blocked">{overdueCount} overdue</span>
			{/if}
		</div>

		{#if !isPool}
			<div class="overflow-x-auto pb-1">
				<FilterTabs
					tabs={[
						{ key: 'assigned', label: 'Assigned', count: counts.open },
						{ key: 'in_progress', label: 'In progress', count: counts.in_progress },
						{ key: 'resolved', label: 'Resolved', count: counts.resolved }
					]}
					active={childFilter}
					onselect={(k) => (childFilter = k)}
					class="w-max"
				/>
			</div>
		{/if}
	</div>

	<!-- Stacked on mobile; tiled into columns on large screens. The "Report an issue" tile is always
	     the first cell, on every tab and regardless of whether there's anything else to show. -->
	<div class="grid grid-cols-1 items-start gap-3 lg:grid-cols-2 2xl:grid-cols-3">
		<button
			type="button"
			onclick={() => (reportOpen = true)}
			class="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-bg text-muted transition-colors hover:border-brand/40 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand lg:h-[15rem]"
		>
			<Plus class="h-6 w-6" aria-hidden="true" />
			<span class="text-sm font-medium">Report an issue</span>
		</button>

		{#if visible.length === 0}
			<div class="flex items-center justify-center rounded-lg border border-border bg-bg lg:h-[15rem]">
				<EmptyState
					icon={icon(ClipboardCheck)}
					title="No {isPool ? 'open' : childLabel[childFilter]} incidents"
					description={isPool ? 'Nothing to take right now.' : 'Try another tab.'}
					compact
				/>
			</div>
		{:else}
			{#each visible as issue (issue.id)}
				<!-- Tiled cards get a fixed height on large screens so the grid reads uniform; content
				     flexes/scrolls, the footer control stays pinned at the bottom. Mobile is natural
				     height. Row-wide click opens the detail modal (see onCardClick); the title button is
				     the keyboard path. -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					class="flex cursor-pointer flex-col rounded-lg border border-border bg-bg p-4 lg:h-[15rem]"
					onclick={(e) => onCardClick(e, issue)}
				>
					<div class="min-h-0 min-w-0 flex-1 lg:overflow-y-auto">
						<div class="flex flex-wrap items-center gap-2">
							<h3 class="font-medium text-ink">
								{#if isPool}
									<button
										type="button"
										onclick={() => openModal(issue)}
										class="rounded-sm text-left underline-offset-2 hover:text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
									>
										{issue.title}
									</button>
								{:else}
									<a
										href={resolve(`/issues/${issue.id}`)}
										class="rounded-sm underline-offset-2 hover:text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
									>
										{issue.title}
									</a>
								{/if}
							</h3>
						</div>
						{#if issue.description}
							<p class="mt-1 line-clamp-2 text-sm text-muted">{issue.description}</p>
						{/if}
					</div>

					<!-- Footer: metadata sits at the bottom, above the divider + control. -->
					<dl class="mt-3 flex shrink-0 flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
						<div>
							<dt class="inline font-medium">AP:</dt>
							<dd class="inline">{issue.networkName ?? 'General'}</dd>
						</div>
						<div>
							<dt class="inline font-medium">Due:</dt>
							<dd class="inline" class:text-blocked={isOverdue(issue)}>{due(issue.dueDate)}</dd>
						</div>
						{#if issue.assignees.length > 1}
							<div>
								<dt class="inline font-medium">Also assigned:</dt>
								<dd class="inline">
									{issue.assignees
										.filter((a) => a.name)
										.map((a) => a.name)
										.join(', ')}
								</dd>
							</div>
						{/if}
					</dl>

					{#if isPool}
						<!-- Pool card: a single Take button self-assigns this incident (?/take). A full
						     update() then reloads both the pool and my incidents. -->
						<form
							class="mt-3 flex shrink-0 flex-wrap items-center gap-2 border-t border-border pt-3"
							method="post"
							action="?/take"
							use:enhance={() => {
								submittingId = issue.id;
								return async ({ result, update }) => {
									if (result.type === 'failure') {
										errors[issue.id] =
											(result.data?.error as string) ?? 'Could not take this incident.';
										await update({ reset: false });
									} else {
										delete errors[issue.id];
										await update();
									}
									submittingId = null;
								};
							}}
						>
							<input type="hidden" name="id" value={issue.id} />
							<StatusBadge tone={issue.priorityTone} label={issue.priorityLabel} />
							<StatusBadge tone={issue.statusTone} label={issue.statusLabel} />
							{#if isOverdue(issue)}
								<StatusBadge tone="blocked" label="Overdue" />
							{/if}
							<div class="ml-auto">
								<Button type="submit" loading={submittingId === issue.id}>Take</Button>
							</div>
							{#if errors[issue.id]}
								<p class="w-full text-sm text-blocked" role="alert">{errors[issue.id]}</p>
							{/if}
						</form>
					{:else}
						<form
							class="mt-3 flex shrink-0 flex-wrap items-center gap-2 border-t border-border pt-3"
							method="post"
							action="?/updateStatus"
							use:enhance={() => {
								submittingId = issue.id;
								return async ({ result, update }) => {
									if (result.type === 'failure') {
										// Drop the optimistic draft so statusOf() falls back to the (unchanged)
										// server status, and surface the error like IssueForm does.
										delete draft[issue.id];
										errors[issue.id] =
											(result.data?.error as string) ?? 'Could not update the incident.';
										await update({ reset: false });
									} else {
										if (result.type === 'success') {
											delete draft[issue.id];
											delete errors[issue.id];
										}
										await update();
									}
									submittingId = null;
								};
							}}
						>
							<input type="hidden" name="id" value={issue.id} />
							<label for="status-{issue.id}" class="sr-only">Status</label>
							<select
								id="status-{issue.id}"
								name="status"
								value={statusOf(issue)}
								disabled={submittingId === issue.id}
								onchange={(e) => {
									draft[issue.id] = e.currentTarget.value;
									e.currentTarget.form?.requestSubmit();
								}}
								class="min-h-11 w-auto cursor-pointer rounded-lg border border-border bg-bg px-2 py-1.5 text-sm text-ink hover:border-brand/40 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
							>
								{#each statusOptions as o (o.value)}
									<option value={o.value}>{o.label}</option>
								{/each}
							</select>

							{#if statusOf(issue) === 'resolved'}
								<label for="note-{issue.id}" class="sr-only">Resolution note (optional)</label>
								<input
									id="note-{issue.id}"
									name="resolutionNote"
									value={issue.resolutionNote ?? ''}
									placeholder="What fixed it?"
									onchange={(e) => e.currentTarget.form?.requestSubmit()}
									class="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm text-ink hover:border-brand/40 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
								/>
							{/if}

							<div class="ml-auto flex items-center gap-2">
								<StatusBadge tone={issue.priorityTone} label={issue.priorityLabel} />
								<StatusBadge tone={issue.statusTone} label={issue.statusLabel} />
								{#if isOverdue(issue)}
									<StatusBadge tone="blocked" label="Overdue" />
								{/if}
								{#if submittingId === issue.id}
									<span class="text-xs text-muted">Saving…</span>
								{/if}
							</div>

							{#if errors[issue.id]}
								<p class="w-full text-sm text-blocked" role="alert">{errors[issue.id]}</p>
							{/if}
						</form>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</div>

<IssueDetailModal bind:open={modalOpen} issue={modalIssue} />
<IssueForm bind:open={reportOpen} issue={null} staff={[]} {networks} sentryIssues={[]} sentryConfigured={false} canAssign={false} />
