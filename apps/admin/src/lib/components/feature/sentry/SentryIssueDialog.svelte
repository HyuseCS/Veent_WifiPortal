<script lang="ts">
	import BellOff from 'lucide-svelte/icons/bell-off';
	import Check from 'lucide-svelte/icons/check';
	import ClipboardPlus from 'lucide-svelte/icons/clipboard-plus';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import X from 'lucide-svelte/icons/x';
	import { enhance } from '$app/forms';
	import { BaseDialog, Button, IconButton, Select, StatusBadge } from '$lib/components/ui';
	import type { StatusTone } from '$lib/types';
	import type { Component } from 'svelte';
	import type { SentryIssue } from '$lib/server/sentry/types';
	import SentryErrorDetail from './SentryErrorDetail.svelte';

	// Detail modal for one issue. The summary (`issue`) is already in hand; the latest event's
	// exception + stacktrace ("which file/line, how & why") is fetched on open from /sentry/event.
	// `levelTone`/`seenAgo` are passed in so the table stays the single source of those helpers.
	// Any viewer can "Track as incident" (source='sentry' form, posted to ?/track). `startTracking`
	// opens the dialog straight into that form (the inline row action) instead of read mode.
	let {
		issue,
		open = $bindable(false),
		levelTone,
		seenAgo,
		startTracking = false,
		assignableStaff = []
	}: {
		issue: SentryIssue | null;
		open?: boolean;
		levelTone: (level: string) => StatusTone;
		seenAgo: (iso: string) => string;
		startTracking?: boolean;
		assignableStaff?: { id: string; name: string; roleLabel: string }[];
	} = $props();

	const inputClass =
		'min-h-11 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink transition-[border-color,box-shadow] duration-150 hover:border-brand/40 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none';
	const priorityOptions = [
		{ value: 'low', label: 'Low' },
		{ value: 'medium', label: 'Medium' },
		{ value: 'high', label: 'High' }
	];

	// "Track as incident" sub-form state. Re-seeded by BaseDialog's reset on every open (title
	// prefilled from the Sentry title, editable). `tracking` toggles the form open.
	let tracking = $state(false);
	let trackTitle = $state('');
	let trackPriority = $state('medium');
	let trackDue = $state('');
	let trackAssignees = $state<string[]>([]);
	let trackError = $state('');
	let trackSubmitting = $state(false);

	function seedTrack() {
		tracking = startTracking;
		trackTitle = issue?.title ?? '';
		trackPriority = 'medium';
		trackDue = '';
		trackAssignees = [];
		trackError = '';
	}
	function toggleTrackAssignee(id: string, checked: boolean) {
		trackAssignees = checked ? [...trackAssignees, id] : trackAssignees.filter((a) => a !== id);
	}
</script>

<BaseDialog bind:open reset={seedTrack} class="max-w-3xl">
	{#if issue}
		<!-- Header adapts to mode: the incident action in track mode, the Sentry identity in read mode. -->
		<div class="flex items-start gap-3">
			<div class="min-w-0 flex-1">
				{#if tracking}
					<div class="flex items-center gap-2 text-ink">
						<ClipboardPlus class="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
						<h2 class="font-semibold">Track as incident</h2>
					</div>
					<p class="mt-1 text-xs text-muted">
						Create an assigned incident from this Sentry error. It stays in the Sentry feed.
					</p>
				{:else}
					<div class="flex items-center gap-2 text-xs text-muted">
						{#if issue.shortId}<span class="font-mono">{issue.shortId}</span>{/if}
						<StatusBadge tone={levelTone(issue.level)} label={issue.level} />
					</div>
					<h2 class="mt-1 font-semibold break-words text-ink">{issue.title}</h2>
				{/if}
			</div>
			<IconButton icon={X as unknown as Component} label="Close" onclick={() => (open = false)} />
		</div>

		{#if tracking}
			<!-- Track container: the incident form IS the outer frame; the Sentry issue it snapshots is
			     nested inside it as context. Creating the incident does NOT resolve/ignore it in Sentry. -->
			<form
				class="mt-4 flex max-h-[72vh] flex-col"
				method="post"
				action="?/track"
				use:enhance={() => {
					trackSubmitting = true;
					return async ({ result, update }) => {
						if (result.type === 'success') {
							tracking = false;
							open = false;
							await update();
						} else if (result.type === 'failure') {
							trackError = (result.data?.error as string) ?? 'Could not create the incident.';
							await update({ reset: false });
						} else {
							await update();
						}
						trackSubmitting = false;
					};
				}}
			>
				<!-- Snapshot fields — read by createIssueFromSentry. -->
				<input type="hidden" name="sentryIssueId" value={issue.id} />
				<input type="hidden" name="sentryShortId" value={issue.shortId} />
				<input type="hidden" name="sentryPermalink" value={issue.permalink} />
				<input type="hidden" name="sentryTitle" value={issue.title} />

				<div class="min-h-0 flex-1 space-y-5 overflow-y-auto pr-0.5">
					<!-- Incident fields (the primary task). -->
					<div class="space-y-3">
						<div class="space-y-1.5">
							<label for="track-title" class="block text-xs font-medium text-ink">Title</label>
							<input
								id="track-title"
								name="issue-title"
								bind:value={trackTitle}
								required
								maxlength={200}
								class={inputClass}
							/>
						</div>

						<div class="grid gap-3 sm:grid-cols-2">
							<Select id="issue-priority" label="Priority" options={priorityOptions} bind:value={trackPriority} />
							<div class="space-y-1.5">
								<label for="track-due" class="block text-xs font-medium text-ink">Due date (optional)</label>
								<input id="track-due" name="issue-dueDate" type="date" bind:value={trackDue} class={inputClass} />
							</div>
						</div>

						<fieldset class="space-y-1.5">
							<legend class="block text-xs font-medium text-ink">Assign to</legend>
							{#if assignableStaff.length === 0}
								<p class="text-xs text-muted">No active staff to assign.</p>
							{:else}
								<div class="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
									{#each assignableStaff as s (s.id)}
										<label class="flex min-h-9 items-center gap-2 rounded-md px-2 py-1 hover:bg-surface">
											<input
												type="checkbox"
												name="assigneeId"
												value={s.id}
												checked={trackAssignees.includes(s.id)}
												onchange={(e) => toggleTrackAssignee(s.id, e.currentTarget.checked)}
												class="h-4 w-4 rounded border-border text-brand focus:ring-brand/30"
											/>
											<span class="text-sm text-ink">{s.name}</span>
											<span class="ml-auto text-xs text-muted">{s.roleLabel}</span>
										</label>
									{/each}
								</div>
							{/if}
						</fieldset>

						{#if trackError}
							<p class="text-sm text-blocked" role="alert">{trackError}</p>
						{/if}
					</div>

					<!-- The Sentry issue being tracked — nested inside the incident container as context. -->
					<div class="space-y-4 rounded-lg border border-border p-3">
						<div class="flex items-start justify-between gap-2">
							<h3 class="text-[11px] font-semibold tracking-wider text-muted uppercase">Sentry issue</h3>
							{#if issue.permalink}
								<!-- absolute external Sentry URL — resolve() (internal paths) doesn't apply. -->
								<!-- eslint-disable svelte/no-navigation-without-resolve -->
								<a
									href={issue.permalink}
									target="_blank"
									rel="noopener noreferrer"
									class="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand hover:underline"
								>
									Open in Sentry <ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
								</a>
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
							{/if}
						</div>
						<div>
							<div class="flex items-center gap-2 text-xs text-muted">
								{#if issue.shortId}<span class="font-mono">{issue.shortId}</span>{/if}
								<StatusBadge tone={levelTone(issue.level)} label={issue.level} />
							</div>
							<p class="mt-1 font-mono text-sm break-words text-ink">{issue.title}</p>
						</div>
						<SentryErrorDetail {issue} {seenAgo} enabled={open} />
					</div>
				</div>

				<div class="mt-4 flex justify-end gap-2 border-t border-border pt-4">
					<Button type="button" variant="secondary" onclick={() => (tracking = false)}>Cancel</Button>
					<Button type="submit" loading={trackSubmitting}>Create incident</Button>
				</div>
			</form>
		{:else}
			<div class="mt-4 max-h-[60vh] space-y-4 overflow-y-auto">
				<SentryErrorDetail {issue} {seenAgo} enabled={open} />
			</div>

			<div class="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
				<button
					type="button"
					onclick={() => (tracking = true)}
					class="mr-auto inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-medium text-white transition-colors hover:bg-brand-hover focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
				>
					<ClipboardPlus class="h-4 w-4" aria-hidden="true" /> Track as incident
				</button>
				<form method="post" action="?/resolve" use:enhance={() => async ({ result, update }) => { if (result.type === 'success') open = false; await update(); }}>
					<input type="hidden" name="id" value={issue.id} />
					<button
						type="submit"
						class="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-bg px-3 text-sm font-medium text-ink transition-colors hover:border-brand/40 hover:bg-surface focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
					>
						<Check class="h-4 w-4" aria-hidden="true" /> Resolve
					</button>
				</form>
				<form method="post" action="?/ignore" use:enhance={() => async ({ result, update }) => { if (result.type === 'success') open = false; await update(); }}>
					<input type="hidden" name="id" value={issue.id} />
					<button
						type="submit"
						class="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-bg px-3 text-sm font-medium text-ink transition-colors hover:border-brand/40 hover:bg-surface focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
					>
						<BellOff class="h-4 w-4" aria-hidden="true" /> Ignore
					</button>
				</form>
				{#if issue.permalink}
					<!-- permalink is an absolute external Sentry URL, so resolve() doesn't apply here. -->
					<!-- eslint-disable svelte/no-navigation-without-resolve -->
					<a
						href={issue.permalink}
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-bg px-3 text-sm font-medium text-ink transition-colors hover:border-brand/40 hover:bg-surface focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
					>
						Open in Sentry <ExternalLink class="h-4 w-4 text-muted" aria-hidden="true" />
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/if}
			</div>
		{/if}
	{/if}
</BaseDialog>
