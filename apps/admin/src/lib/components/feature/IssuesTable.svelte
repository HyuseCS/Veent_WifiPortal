<script lang="ts">
	import Check from 'lucide-svelte/icons/check';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import ClipboardList from 'lucide-svelte/icons/clipboard-list';
	import Pencil from 'lucide-svelte/icons/pencil';
	import Plus from 'lucide-svelte/icons/plus';
	import Search from 'lucide-svelte/icons/search';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import X from 'lucide-svelte/icons/x';
	import type { Component } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { enhance } from '$app/forms';
	import { Button, EmptyState, IconButton, SearchInput, StatusBadge, Table } from '$lib/components/ui';
	import type { AdminIssueRow } from '$lib/server/issues';

	// Manager board (owner / system_admin). Row actions post to the page's form actions
	// (?/updateStatus, ?/remove); edit/new open the shared <IssueForm> via callbacks. The
	// route enforces manager access — this component is only rendered when canManage.
	let {
		issues,
		onedit,
		onnew
	}: {
		issues: AdminIssueRow[];
		onedit: (issue: AdminIssueRow) => void;
		onnew: () => void;
	} = $props();

	const icon = (c: unknown) => c as Component;

	let query = $state('');
	let confirmingId = $state<number | null>(null); // delete confirm
	const expanded = new SvelteSet<number>(); // rows showing full detail (reactive on mutation)

	function toggleExpand(id: number) {
		if (expanded.has(id)) expanded.delete(id);
		else expanded.add(id);
	}

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return issues;
		return issues.filter((i) =>
			`${i.title} ${i.description ?? ''} ${i.networkName ?? ''} ${i.assignees
				.map((a) => a.name)
				.join(' ')}`
				.toLowerCase()
				.includes(q)
		);
	});

	const headers = ['Issue', 'Access point', 'Priority', 'Status', 'Assignees', 'Due', 'Actions'];

	const statusOptions = [
		{ value: 'open', label: 'Open' },
		{ value: 'in_progress', label: 'In Progress' },
		{ value: 'resolved', label: 'Resolved' }
	];

	function dueLabel(ms: number | null): string {
		return ms ? new Date(ms).toLocaleDateString() : '—';
	}
	// Past-due and still unresolved → flag it.
	const isOverdue = (i: AdminIssueRow) =>
		i.dueDate != null && i.status !== 'resolved' && i.dueDate < Date.now();
</script>

<Table cards class="min-h-0 flex-1">
	{#snippet toolbar()}
		<div class="flex flex-wrap items-center gap-3 px-4 py-3">
			<h2 class="text-base font-semibold text-ink">Issues</h2>
			<SearchInput
				bind:value={query}
				placeholder="Search title, AP or assignee…"
				label="Search issues"
				class="ml-auto min-w-0 flex-1 sm:max-w-xs"
			/>
			<Button onclick={onnew} class="shrink-0">
				<Plus class="h-4 w-4" aria-hidden="true" />
				New issue
			</Button>
		</div>
	{/snippet}

	{#snippet headRow()}
		<tr class="border-b border-border bg-surface">
			{#each headers as h (h)}
				<th
					class="px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-muted uppercase"
					class:sr-only={h === 'Actions'}
				>
					{h}
				</th>
			{/each}
		</tr>
	{/snippet}

	{#each filtered as issue (issue.id)}
		<tr class="align-top hover:bg-surface" class:opacity-60={issue.status === 'resolved'}>
			<td class="tc-full px-4 py-3">
				<div class="flex items-start gap-2">
					<button
						type="button"
						onclick={() => toggleExpand(issue.id)}
						aria-expanded={expanded.has(issue.id)}
						aria-label={expanded.has(issue.id) ? 'Collapse issue details' : 'Expand issue details'}
						class="mt-0.5 shrink-0 rounded text-muted transition-colors hover:text-ink"
					>
						{#if expanded.has(issue.id)}
							<ChevronDown class="h-5 w-5 hover:cursor-pointer" aria-hidden="true" />
						{:else}
							<ChevronRight class="h-5 w-5 hover:cursor-pointer" aria-hidden="true" />
						{/if}
					</button>
					<div class="min-w-0">
						<div class="truncate font-medium text-ink">{issue.title}</div>
					</div>
				</div>
			</td>
			<td data-label="Access point" class="px-4 py-3 text-sm text-ink">
				{issue.networkName ?? 'General'}
			</td>
			<td data-label="Priority" class="px-4 py-3">
				<StatusBadge tone={issue.priorityTone} label={issue.priorityLabel} />
			</td>
			<td data-label="Status" class="px-4 py-3">
				<!-- Inline status change (auto-submits on change). Resolving here leaves the note
				     empty; assignees add a note from their My Issues view. -->
				<form method="post" action="?/updateStatus" use:enhance>
					<input type="hidden" name="id" value={issue.id} />
					<select
						name="status"
						value={issue.status}
						aria-label="Status for {issue.title}"
						onchange={(e) => e.currentTarget.form?.requestSubmit()}
						class="min-h-9 cursor-pointer rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-ink hover:border-brand/40 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
					>
						{#each statusOptions as o (o.value)}
							<option value={o.value}>{o.label}</option>
						{/each}
					</select>
				</form>
			</td>
			<td data-label="Assignees" class="px-4 py-3 text-sm text-ink">
				{#if issue.assignees.length === 0}
					<span class="text-muted">Unassigned</span>
				{:else}
					<span class="text-xs">{issue.assignees.map((a) => a.name).join(', ')}</span>
				{/if}
			</td>
			<td data-label="Due" class="px-4 py-3 text-sm">
				<span class:text-blocked={isOverdue(issue)} class:text-muted={!isOverdue(issue)}>
					{dueLabel(issue.dueDate)}
				</span>
			</td>
			<td class="tc-full px-4 py-3">
				{#if confirmingId === issue.id}
					<div class="flex items-center justify-end gap-1">
						<span class="text-xs text-muted">Delete?</span>
						<form
							method="post"
							action="?/remove"
							use:enhance={() =>
								async ({ update }) => {
									confirmingId = null;
									await update();
								}}
						>
							<input type="hidden" name="id" value={issue.id} />
							<IconButton
								type="submit"
								icon={icon(Check)}
								label="Confirm deleting {issue.title}"
								tone="danger"
							/>
						</form>
						<IconButton icon={icon(X)} label="Cancel" onclick={() => (confirmingId = null)} />
					</div>
				{:else}
					<div class="flex items-center justify-end gap-1">
						<IconButton icon={icon(Pencil)} label="Edit {issue.title}" onclick={() => onedit(issue)} />
						<IconButton
							icon={icon(Trash2)}
							label="Delete {issue.title}"
							tone="danger"
							onclick={() => (confirmingId = issue.id)}
						/>
					</div>
				{/if}
			</td>
		</tr>
		{#if expanded.has(issue.id)}
			<tr class="border-b border-border bg-surface/40">
				<td colspan={headers.length} class="tc-full px-4 py-3 pl-10">
					<div class="space-y-2 text-sm">
						<div>
							<span class="font-medium text-ink">Description</span>
							<p class="mt-0.5 whitespace-pre-wrap text-muted">
								{issue.description || 'No description provided.'}
							</p>
						</div>
						<div class="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
							<span>
								<span class="font-medium text-ink">Assignees:</span>
								{issue.assignees.length ? issue.assignees.map((a) => a.name).join(', ') : 'Unassigned'}
							</span>
							<span><span class="font-medium text-ink">Access point:</span> {issue.networkName ?? 'General'}</span>
							<span><span class="font-medium text-ink">Due:</span> {dueLabel(issue.dueDate)}</span>
							<span>
								<span class="font-medium text-ink">Created:</span>
								{new Date(issue.createdAt).toLocaleString()}
							</span>
							<span>
								<span class="font-medium text-ink">Updated:</span>
								{new Date(issue.updatedAt).toLocaleString()}
							</span>
						</div>
						{#if issue.resolutionNote}
							<div>
								<span class="font-medium text-ink">Resolution:</span>
								<span class="text-muted">{issue.resolutionNote}</span>
							</div>
						{/if}
					</div>
				</td>
			</tr>
		{/if}
	{/each}

	{#if filtered.length === 0}
		<tr>
			<td colspan={headers.length} class="tc-full p-0">
				<EmptyState
					icon={icon(query ? Search : ClipboardList)}
					title={query ? 'No issues match' : 'No issues yet'}
					description={query ? 'Try a different search term.' : 'Create the first issue to start tracking.'}
					compact
				/>
			</td>
		</tr>
	{/if}

	{#snippet footer()}
		<p class="px-4 py-3 text-xs text-muted">Showing {filtered.length} of {issues.length} issues</p>
	{/snippet}
</Table>
