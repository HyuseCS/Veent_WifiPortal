<script lang="ts">
	import ClipboardList from 'lucide-svelte/icons/clipboard-list';
	import type { Component } from 'svelte';
	import { enhance } from '$app/forms';
	import { Button, EmptyState, StatusBadge } from '$lib/components/ui';
	import type { AdminIssueRow } from '$lib/server/issues';

	// Assignee "My Issues" view. Read-only details plus a per-issue status control; choosing
	// "Resolved" reveals a resolution-note field. Posts to ?/updateStatus, which the route
	// authorises as manager-OR-assignee-of-this-issue.
	let { issues }: { issues: AdminIssueRow[] } = $props();

	const icon = (c: unknown) => c as Component;

	// Per-issue selected status (drives whether the resolution-note field shows).
	let draft = $state<Record<number, string>>({});
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
</script>

{#if issues.length === 0}
	<div class="rounded-xl border border-border bg-surface">
		<EmptyState
			icon={icon(ClipboardList)}
			title="No issues assigned to you"
			description="When a manager assigns you an issue, it shows up here."
		/>
	</div>
{:else}
	<div class="space-y-3">
		{#each issues as issue (issue.id)}
			<div class="rounded-xl border border-border bg-surface p-4">
				<div class="flex flex-wrap items-start gap-3">
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-2">
							<h3 class="font-medium text-ink">{issue.title}</h3>
							<StatusBadge tone={issue.priorityTone} label={issue.priorityLabel} />
							<StatusBadge tone={issue.statusTone} label={issue.statusLabel} />
						</div>
						{#if issue.description}
							<p class="mt-1 text-sm text-muted">{issue.description}</p>
						{/if}
						<dl class="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
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
									<dd class="inline">{issue.assignees.map((a) => a.name).join(', ')}</dd>
								</div>
							{/if}
						</dl>
					</div>
				</div>

				<form
					class="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3"
					method="post"
					action="?/updateStatus"
					use:enhance={() => {
						submittingId = issue.id;
						return async ({ update }) => {
							await update();
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
							class="min-h-9 cursor-pointer rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm text-ink hover:border-brand/40 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
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
								class="min-h-9 w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm text-ink hover:border-brand/40 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
							/>
						</div>
					{/if}

					<Button type="submit" loading={submittingId === issue.id}>Update</Button>
				</form>
			</div>
		{/each}
	</div>
{/if}
