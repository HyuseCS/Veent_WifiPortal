<script lang="ts">
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import Ban from 'lucide-svelte/icons/ban';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import type { Component } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { BaseDialog, IconButton, StatusBadge } from '$lib/components/ui';
	import X from 'lucide-svelte/icons/x';
	import Timeline from './Timeline.svelte';
	import type { AdminIssueRow, IssueEventRow } from '$lib/server/issues';
	import type { NotificationRow } from '$lib/server/notifications';

	/**
	 * Preview modal for a bell notification. Opened INSTEAD of navigating to /issues/[id] so a click
	 * never dumps the user on a full-page 404 for an incident they can no longer reach (e.g. they were
	 * unassigned and it was since reassigned or resolved). We fetch the same read-only endpoint the
	 * assignee detail modal uses and branch on its answer — WITHOUT changing its authorization:
	 *   • 200  → the user can still see it: show the preview + a link to the full page.
	 *   • 404/401 → access is gone (M3): show a graceful summary from the notification itself. No
	 *     incident details are fetched, so the access boundary the audit closed is untouched.
	 */
	let {
		notification,
		open = $bindable(false)
	}: {
		notification: NotificationRow | null;
		open?: boolean;
	} = $props();

	const fmtDateTime = (ms: number) => new Date(ms).toLocaleString();

	let loading = $state(true);
	let issue = $state<AdminIssueRow | null>(null);
	let events = $state<IssueEventRow[]>([]);
	let noAccess = $state(false);
	let failed = $state(false);

	// "View full incident" links to /issues/[id], whose page load admits ONLY a manager (owner /
	// system_admin) or the incident's current assignee. The detail endpoint above is more permissive
	// (it also returns an open, unclaimed pool incident to any signed-in staff), so a removed-from-task
	// viewer can reach a 200 preview here yet still 404 on the page. Gate the link to exactly who the
	// page will let in, so it never appears when it would dead-end.
	const canOpenFull = $derived(
		!!issue &&
			(page.data.user?.role === 'owner' ||
				page.data.user?.role === 'system_admin' ||
				issue.assignees.some((a) => a.id === page.data.user?.id))
	);

	// Re-seeded by BaseDialog on every open so reopening on a different notification never flashes
	// the previous incident's content.
	function reset() {
		loading = true;
		issue = null;
		events = [];
		noAccess = false;
		failed = false;
	}

	$effect(() => {
		const id = open ? notification?.issueId : null;
		if (!id) return;
		loading = true;
		issue = null;
		events = [];
		noAccess = false;
		failed = false;
		const controller = new AbortController();
		fetch(`/issues/${id}/detail`, { signal: controller.signal })
			.then(async (r) => {
				if (r.ok) {
					const d = (await r.json()) as { issue: AdminIssueRow; events: IssueEventRow[] };
					issue = d.issue;
					events = d.events;
				} else if (r.status === 404 || r.status === 401) {
					noAccess = true;
				} else {
					failed = true;
				}
			})
			.catch((e: unknown) => {
				if (!(e instanceof DOMException && e.name === 'AbortError')) failed = true;
			})
			// Only the still-current request clears the spinner — an aborted (stale) one must not hide
			// it for the newer fetch that replaced it.
			.finally(() => {
				if (!controller.signal.aborted) loading = false;
			});
		return () => controller.abort();
	});
</script>

<BaseDialog bind:open {reset} class="max-w-2xl">
	{#if notification}
		<div class="flex items-start gap-3">
			<div class="min-w-0 flex-1">
				<h2 class="min-w-0 text-lg font-semibold break-words text-ink">
					{issue ? issue.title : notification.issueTitle}
				</h2>
				{#if issue}
					<div class="mt-1.5 flex flex-wrap gap-2">
						<StatusBadge tone={issue.priorityTone} label={issue.priorityLabel} />
						<StatusBadge tone={issue.statusTone} label={issue.statusLabel} />
					</div>
				{/if}
			</div>
			<IconButton icon={X as unknown as Component} label="Close" onclick={() => (open = false)} />
		</div>

		<div class="mt-4 max-h-[70vh] space-y-4 overflow-y-auto pr-0.5">
			{#if loading}
				<div class="flex items-center gap-2 py-6 text-sm text-muted">
					<LoaderCircle class="h-4 w-4 animate-spin" aria-hidden="true" />
					Loading incident…
				</div>
			{:else if issue}
				{#if issue.description}
					<p class="text-sm whitespace-pre-wrap text-muted">{issue.description}</p>
				{/if}

				<div>
					<h3 class="mb-2 text-sm font-semibold text-ink">History</h3>
					<Timeline {events} />
				</div>

				{#if canOpenFull}
					<a
						href={resolve(`/issues/${notification.issueId}`)}
						onclick={() => (open = false)}
						class="inline-flex items-center gap-1.5 text-sm font-medium text-brand outline-none hover:underline focus-visible:underline"
					>
						View full incident
						<ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
					</a>
				{/if}
			{:else if noAccess}
				<div class="rounded-lg border border-border bg-surface p-3 text-sm">
					<div class="flex items-center gap-2 text-ink">
						<Ban class="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
						<span class="font-medium">{notification.summary}</span>
					</div>
					<p class="mt-2 text-muted">
						You're no longer assigned to this incident, so its current details aren't available.
					</p>
					<p class="mt-1 text-xs text-muted">{fmtDateTime(notification.createdAt)}</p>
				</div>
			{:else if failed}
				<div class="flex items-center gap-2 rounded-lg border border-border bg-surface p-3 text-sm text-muted">
					<TriangleAlert class="h-4 w-4 shrink-0" aria-hidden="true" />
					Couldn't load this incident. Please try again.
				</div>
			{/if}
		</div>
	{/if}
</BaseDialog>
