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
	import { goto } from '$app/navigation';
	import { Button, EmptyState, IconButton, SearchInput, StatusBadge, Table } from '$lib/components/ui';
	import Timeline from './Timeline.svelte';
	import type { AdminIssueRow, IssueEventRow } from '$lib/server/issues';

	// Manager board (owner / system_admin). Row actions post to the page's form actions
	// (?/updateStatus, ?/remove); edit/new open the shared <IssueForm> via callbacks. The
	// route enforces manager access — this component is only rendered when canManage.
	let {
		issues,
		events,
		onedit,
		onnew
	}: {
		issues: AdminIssueRow[];
		/** Audit timeline per issue id (newest-first), for the expanded-row history. */
		events: Record<number, IssueEventRow[]>;
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

	// Whole-row navigation to the detail page. Clicks that land on an interactive control (the
	// expand chevron, the status <select>, the edit/delete buttons, or the title link itself) are
	// left alone — those keep their own behaviour. The title <a> stays the keyboard/right-click path.
	function openIssue(e: MouseEvent, id: number) {
		if ((e.target as HTMLElement).closest('a, button, select, input, form, label')) return;
		goto(`/issues/${id}`);
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
			<h2 class="text-base font-semibold text-ink">Incidents</h2>
			<SearchInput
				bind:value={query}
				placeholder="Search title, AP or assignee…"
				label="Search incidents"
				class="ml-auto min-w-0 flex-1 sm:max-w-xs"
			/>
			<Button onclick={onnew} class="shrink-0">
				<Plus class="h-4 w-4" aria-hidden="true" />
				New incident
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
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<!-- Row-wide click opens the incident (see openIssue); the title <a> is the keyboard path. -->
		<tr
			class="cursor-pointer align-top hover:bg-surface"
			class:opacity-60={issue.status === 'resolved'}
			onclick={(e) => openIssue(e, issue.id)}
		>
			<td class="tc-full max-w-[16rem] px-4 py-3 sm:max-w-[24rem]">
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
						<a
							href="/issues/{issue.id}"
							title={issue.title}
							class="block truncate font-medium text-ink underline-offset-2 hover:text-brand hover:underline"
						>
							{issue.title}
						</a>
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
				<!-- Read-only here — status is changed from the incident detail page (open the row). -->
				<StatusBadge tone={issue.statusTone} label={issue.statusLabel} />
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
						<div class="border-t border-border pt-3">
							<span class="mb-2 block font-medium text-ink">History</span>
							<Timeline events={events[issue.id] ?? []} />
						</div>
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
					title={query ? 'No incidents match' : 'No incidents yet'}
					description={query ? 'Try a different search term.' : 'Create the first incident to start tracking.'}
					compact
				/>
			</td>
		</tr>
	{/if}

	{#snippet footer()}
		<p class="px-4 py-3 text-xs text-muted">Showing {filtered.length} of {issues.length} incidents</p>
	{/snippet}
</Table>
