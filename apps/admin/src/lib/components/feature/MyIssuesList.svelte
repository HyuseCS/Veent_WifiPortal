<script lang="ts">
	import ClipboardList from 'lucide-svelte/icons/clipboard-list';
	import ClipboardCheck from 'lucide-svelte/icons/clipboard-check';
	import type { Component } from 'svelte';
	import { enhance } from '$app/forms';
	import { Button, EmptyState, FilterTabs, StatusBadge } from '$lib/components/ui';
	import type { AdminIssueRow } from '$lib/server/issues';

	// Assignee "My incidents" view. A header (count + overdue summary) and status filter tabs sit
	// above the same read-detail + inline status control as before; choosing "Resolved" reveals a
	// resolution-note field. Posts to ?/updateStatus, which the route authorises as
	// manager-OR-assignee-of-this-issue. Filtering/sorting/counts are all client-side over the
	// already-loaded rows — no server change.
	let { issues }: { issues: AdminIssueRow[] } = $props();

	const icon = (c: unknown) => c as Component;

	// Per-issue selected status (drives whether the resolution-note field shows) + per-issue
	// error surfaced from a failed submit.
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

	// Status filter (client-side). Default 'all' so nothing assigned is hidden on load — the sort
	// surfaces urgency instead.
	type Filter = 'all' | 'open' | 'in_progress' | 'resolved';
	let filter = $state<Filter>('all');

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

	const visible = $derived.by(() => {
		const list = filter === 'all' ? issues : issues.filter((i) => i.status === filter);
		return [...list].sort(cmp);
	});

	const filterLabel: Record<Filter, string> = {
		all: '',
		open: 'open',
		in_progress: 'in-progress',
		resolved: 'resolved'
	};
</script>

{#if issues.length === 0}
	<div class="flex min-h-full items-center justify-center rounded-lg border border-border bg-bg">
		<EmptyState
			icon={icon(ClipboardList)}
			title="No incidents assigned to you"
			description="When a manager assigns you an incident, it shows up here."
		/>
	</div>
{:else}
	<div class="flex min-h-full flex-col gap-4">
		<!-- Section header, one line: the Topbar owns the page <h1> ("Incidents"); this scoped <h2>
		     (plus an overdue count when any) sits left, the status filter right. Wraps on mobile. -->
		<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
			<div class="flex items-baseline gap-2">
				<h2 class="text-base font-semibold text-ink">My incidents</h2>
				{#if overdueCount}
					<span class="text-sm font-medium text-blocked">{overdueCount} overdue</span>
				{/if}
			</div>

			<div class="overflow-x-auto pb-1">
				<FilterTabs
					tabs={[
						{ key: 'open', label: 'Open', count: counts.open },
						{ key: 'in_progress', label: 'In progress', count: counts.in_progress },
						{ key: 'resolved', label: 'Resolved', count: counts.resolved },
						{ key: 'all', label: 'All', count: issues.length }
					]}
					active={filter}
					onselect={(k) => (filter = k)}
					class="w-max"
				/>
			</div>
		</div>

		{#if visible.length === 0}
			<div class="flex flex-1 items-center justify-center rounded-lg border border-border bg-bg">
				<EmptyState
					icon={icon(ClipboardCheck)}
					title="No {filterLabel[filter]} incidents"
					description="Nothing here under this filter — try another tab."
				/>
			</div>
		{:else}
			<!-- Stacked on mobile; tiled into columns on large screens so cards aren't full-width. -->
			<div class="grid grid-cols-1 items-start gap-3 lg:grid-cols-2 2xl:grid-cols-3">
				{#each visible as issue (issue.id)}
					<!-- Tiled cards get a uniform height band on large screens (min floor + max ceiling);
					     content flexes/scrolls, the status form stays pinned at the bottom. Mobile is
					     natural height. -->
					<div class="flex flex-col rounded-lg border border-border bg-bg p-4 lg:min-h-[15rem] lg:max-h-[21rem]">
						<div class="min-h-0 min-w-0 flex-1 lg:overflow-y-auto">
							<div class="flex flex-wrap items-center gap-2">
								<h3 class="font-medium text-ink">
									<a
										href="/issues/{issue.id}"
										class="rounded-sm underline-offset-2 hover:text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
									>
										{issue.title}
									</a>
								</h3>
								<StatusBadge tone={issue.priorityTone} label={issue.priorityLabel} />
								<StatusBadge tone={issue.statusTone} label={issue.statusLabel} />
								{#if isOverdue(issue)}
									<StatusBadge tone="blocked" label="Overdue" />
								{/if}
							</div>
							{#if issue.description}
								<p class="mt-1 line-clamp-2 text-sm text-muted">{issue.description}</p>
							{/if}
						</div>

						<!-- Footer: metadata sits at the bottom, above the divider + status control. -->
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

						<form
							class="mt-3 flex shrink-0 flex-wrap items-end gap-2 border-t border-border pt-3"
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
							<div class="space-y-1">
								<label for="status-{issue.id}" class="block text-xs font-medium text-ink">Status</label>
								<select
									id="status-{issue.id}"
									name="status"
									value={statusOf(issue)}
									onchange={(e) => (draft[issue.id] = e.currentTarget.value)}
									class="min-h-11 cursor-pointer rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm text-ink hover:border-brand/40 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
								>
									{#each statusOptions as o (o.value)}
										<option value={o.value}>{o.label}</option>
									{/each}
								</select>
							</div>

							{#if statusOf(issue) === 'resolved'}
								<div class="min-w-0 flex-1 space-y-1">
									<label for="note-{issue.id}" class="block text-xs font-medium text-ink">
										Resolution note (optional)
									</label>
									<input
										id="note-{issue.id}"
										name="resolutionNote"
										value={issue.resolutionNote ?? ''}
										placeholder="What fixed it?"
										class="min-h-11 w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm text-ink hover:border-brand/40 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
									/>
								</div>
							{/if}

							<Button type="submit" loading={submittingId === issue.id}>Update</Button>

							{#if errors[issue.id]}
								<p class="w-full text-sm text-blocked" role="alert">{errors[issue.id]}</p>
							{/if}
						</form>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
