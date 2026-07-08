<script lang="ts">
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import Activity from 'lucide-svelte/icons/activity';
	import MapPin from 'lucide-svelte/icons/map-pin';
	import { enhance } from '$app/forms';
	import { Button, StatusBadge } from '$lib/components/ui';
	import { Timeline } from '$lib/components/feature';
	import type { PageData } from './$types';

	// Per-incident detail. Read-only fields + a comment composer + the full audit timeline. Both
	// roles reach it (access is enforced in the load); assignees still change status from My Issues.
	let { data }: { data: PageData } = $props();
	const issue = $derived(data.issue);

	const inputClass =
		'min-h-11 w-full rounded-lg border border-border bg-bg px-4 py-3 text-sm text-ink transition-[border-color,box-shadow] duration-150 hover:border-brand/40 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none';

	let body = $state('');
	let error = $state('');
	let submitting = $state(false);

	const fmtDate = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString() : '—');
	const fmtDateTime = (ms: number) => new Date(ms).toLocaleString();
	const isOverdue = $derived(
		issue.dueDate != null && issue.status !== 'resolved' && issue.dueDate < Date.now()
	);
</script>

<div class="mx-auto flex h-full w-full max-w-3xl flex-col gap-4">
	<a
		href="/issues"
		class="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-ink"
	>
		<ArrowLeft class="h-4 w-4" aria-hidden="true" />
		Back to incidents
	</a>

	<!-- Header -->
	<div class="rounded-xl border border-border bg-surface p-4 sm:p-5">
		<div class="flex flex-wrap items-start gap-x-3 gap-y-2">
			<h1 class="min-w-0 flex-1 text-lg font-semibold break-words text-ink sm:text-xl">
				{issue.title}
			</h1>
			<div class="flex shrink-0 flex-wrap gap-2">
				<StatusBadge tone={issue.priorityTone} label={issue.priorityLabel} />
				<StatusBadge tone={issue.statusTone} label={issue.statusLabel} />
			</div>
		</div>

		{#if issue.description}
			<p class="mt-3 text-sm whitespace-pre-wrap text-muted">{issue.description}</p>
		{/if}

		<!-- Source-aware section: human → the linked access point / field context; sentry → its
		     origin (the Sentry snapshot + permalink land in Phase 4). -->
		<div class="mt-4 rounded-lg border border-border bg-bg p-3">
			{#if issue.source === 'sentry'}
				<div class="flex items-center gap-2 text-sm text-ink">
					<Activity class="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
					<span class="font-medium">Tracked from Sentry</span>
				</div>
				<p class="mt-1 text-xs text-muted">A code error a manager promoted to an incident.</p>
			{:else}
				<div class="flex items-center gap-2 text-sm text-ink">
					<MapPin class="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
					<span class="font-medium">Access point:</span>
					<span>{issue.networkName ?? 'General (no access point)'}</span>
				</div>
			{/if}
		</div>

		<dl class="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
			<div>
				<dt class="text-xs font-medium text-muted">Assignees</dt>
				<dd class="mt-0.5 text-ink">
					{issue.assignees.length ? issue.assignees.map((a) => a.name).join(', ') : 'Unassigned'}
				</dd>
			</div>
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

		{#if issue.resolutionNote}
			<div class="mt-4 rounded-lg border border-online/30 bg-online/5 p-3">
				<p class="text-xs font-medium text-muted">Resolution</p>
				<p class="mt-0.5 text-sm whitespace-pre-wrap text-ink">{issue.resolutionNote}</p>
			</div>
		{/if}
	</div>

	<!-- Comment composer -->
	<div class="rounded-xl border border-border bg-surface p-4 sm:p-5">
		<h2 class="text-sm font-semibold text-ink">Add a comment</h2>
		<form
			class="mt-2 space-y-2"
			method="post"
			action="?/comment"
			use:enhance={() => {
				submitting = true;
				return async ({ result, update }) => {
					if (result.type === 'success') {
						body = '';
						error = '';
						await update(); // reload → the new comment shows in the timeline below
					} else if (result.type === 'failure') {
						error = (result.data?.error as string) ?? 'Could not post the comment.';
						await update({ reset: false });
					} else {
						await update();
					}
					submitting = false;
				};
			}}
		>
			<label for="comment-body" class="sr-only">Comment</label>
			<textarea
				id="comment-body"
				name="body"
				rows="3"
				bind:value={body}
				maxlength={2000}
				placeholder="Add an update, a finding, or a question…"
				class={inputClass}
			></textarea>
			{#if error}
				<p class="text-sm text-blocked" role="alert">{error}</p>
			{/if}
			<div class="flex justify-end">
				<Button type="submit" loading={submitting} disabled={!body.trim()}>Comment</Button>
			</div>
		</form>
	</div>

	<!-- Timeline -->
	<div class="rounded-xl border border-border bg-surface p-4 sm:p-5">
		<h2 class="mb-3 text-sm font-semibold text-ink">History</h2>
		<Timeline events={data.events} />
	</div>
</div>
