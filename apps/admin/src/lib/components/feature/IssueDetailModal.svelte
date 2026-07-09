<script lang="ts">
	import X from 'lucide-svelte/icons/x';
	import MapPin from 'lucide-svelte/icons/map-pin';
	import Activity from 'lucide-svelte/icons/activity';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import type { Component } from 'svelte';
	import { enhance } from '$app/forms';
	import { BaseDialog, Button, IconButton, StatusBadge } from '$lib/components/ui';
	import Timeline from './Timeline.svelte';
	import type { AdminIssueRow, IssueEventRow } from '$lib/server/issues';

	/**
	 * Quick preview + Take for one "Open pool" incident (MyIssuesList only ever opens this for a
	 * pool card — unassigned, by construction of listOpenPool). The card's own AdminIssueRow already
	 * has every header field; only the audit timeline is fetched (from /issues/[id]/detail) on open,
	 * since the list load never carries event history. Once you own it, the full /issues/[id] page
	 * (status form + comments) is where you manage it — this modal closes itself on a successful Take.
	 */
	let {
		issue,
		open = $bindable(false)
	}: {
		issue: AdminIssueRow | null;
		open?: boolean;
	} = $props();

	const fmtDate = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString() : '—');
	const fmtDateTime = (ms: number) => new Date(ms).toLocaleString();
	const isOverdue = $derived(
		!!issue && issue.dueDate != null && issue.status !== 'resolved' && issue.dueDate < Date.now()
	);

	let takeError = $state('');
	let takeSubmitting = $state(false);

	// Re-seeded by BaseDialog on every open, so switching between cards never leaks stale state.
	function reset() {
		takeError = '';
		takeSubmitting = false;
	}

	// Timeline: fetched fresh whenever the dialog opens on an issue — the card row doesn't carry
	// event history, so there's nothing to derive it from locally.
	let events = $state<IssueEventRow[]>([]);
	let loadingEvents = $state(false);
	let eventsFailed = $state(false);

	$effect(() => {
		const id = open ? issue?.id : null;
		if (!id) {
			events = [];
			return;
		}
		eventsFailed = false;
		loadingEvents = true;
		const controller = new AbortController();
		fetch(`/issues/${id}/detail`, { signal: controller.signal })
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
			.then((d: { events: IssueEventRow[] }) => (events = d.events))
			.catch((e: unknown) => {
				if (!(e instanceof DOMException && e.name === 'AbortError')) eventsFailed = true;
			})
			// Only the still-current request may clear the spinner — an aborted (stale) one must not
			// hide the spinner for the newer fetch that replaced it.
			.finally(() => {
				if (!controller.signal.aborted) loadingEvents = false;
			});
		return () => controller.abort();
	});
</script>

<BaseDialog bind:open {reset} class="max-w-2xl">
	{#if issue}
		<div class="flex items-start gap-3">
			<div class="min-w-0 flex-1">
				<h2 class="min-w-0 text-lg font-semibold break-words text-ink">{issue.title}</h2>
				<div class="mt-1.5 flex flex-wrap gap-2">
					<StatusBadge tone={issue.priorityTone} label={issue.priorityLabel} />
					<StatusBadge tone={issue.statusTone} label={issue.statusLabel} />
					{#if isOverdue}
						<StatusBadge tone="blocked" label="Overdue" />
					{/if}
				</div>
			</div>
			<IconButton icon={X as unknown as Component} label="Close" onclick={() => (open = false)} />
		</div>

		<div class="mt-4 max-h-[70vh] space-y-4 overflow-y-auto pr-0.5">
			{#if issue.description}
				<p class="text-sm whitespace-pre-wrap text-muted">{issue.description}</p>
			{/if}

			<!-- Source-aware section, same as the full detail page: human → the linked AP; sentry →
			     its origin snapshot + permalink. -->
			<div class="rounded-lg border border-border bg-surface p-3">
				{#if issue.source === 'sentry'}
					<div class="flex flex-wrap items-center gap-2 text-sm text-ink">
						<Activity class="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
						<span class="font-medium">Tracked from Sentry</span>
						{#if issue.sentryShortId}
							<span class="font-mono text-xs text-muted">{issue.sentryShortId}</span>
						{/if}
					</div>
					{#if issue.sentryTitle}
						<p class="mt-1 font-mono text-xs break-words text-muted">{issue.sentryTitle}</p>
					{/if}
					{#if issue.sentryPermalink}
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						<a
							href={issue.sentryPermalink}
							target="_blank"
							rel="noopener noreferrer"
							class="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
						>
							Open in Sentry
							<ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
						</a>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					{/if}
				{:else}
					<div class="flex items-center gap-2 text-sm text-ink">
						<MapPin class="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
						<span class="font-medium">Access point:</span>
						<span>{issue.networkName ?? 'General (no access point)'}</span>
					</div>
				{/if}
			</div>

			<dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
				<div>
					<dt class="text-xs font-medium text-muted">Due</dt>
					<dd class="mt-0.5" class:text-blocked={isOverdue} class:text-ink={!isOverdue}>
						{fmtDate(issue.dueDate)}
					</dd>
				</div>
				<div>
					<dt class="text-xs font-medium text-muted">Created</dt>
					<dd class="mt-0.5 text-ink">{fmtDateTime(issue.createdAt)}</dd>
				</div>
			</dl>

			<form
				method="post"
				action="?/take"
				use:enhance={() => {
					takeSubmitting = true;
					return async ({ result, update }) => {
						if (result.type === 'failure') {
							takeError = (result.data?.error as string) ?? 'Could not take this incident.';
							await update({ reset: false });
							takeSubmitting = false;
						} else {
							await update();
							open = false; // it's no longer a pool item — manage it from /issues/[id] instead
						}
					};
				}}
			>
				<input type="hidden" name="id" value={issue.id} />
				<Button type="submit" loading={takeSubmitting}>Take this incident</Button>
				{#if takeError}
					<p class="mt-2 text-sm text-blocked" role="alert">{takeError}</p>
				{/if}
			</form>

			<div>
				<h3 class="mb-2 text-sm font-semibold text-ink">History</h3>
				{#if loadingEvents}
					<div class="flex items-center gap-2 py-4 text-sm text-muted">
						<LoaderCircle class="h-4 w-4 animate-spin" aria-hidden="true" />
						Loading history…
					</div>
				{:else if eventsFailed}
					<div
						class="flex items-center gap-2 rounded-lg border border-border bg-surface p-3 text-sm text-muted"
					>
						<TriangleAlert class="h-4 w-4 shrink-0" aria-hidden="true" />
						Couldn't load the history. Everything above is still current.
					</div>
				{:else}
					<Timeline {events} />
				{/if}
			</div>
		</div>
	{/if}
</BaseDialog>
