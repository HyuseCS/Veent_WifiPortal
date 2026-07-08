<script lang="ts">
	import ClipboardList from 'lucide-svelte/icons/clipboard-list';
	import ClipboardPlus from 'lucide-svelte/icons/clipboard-plus';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import Search from 'lucide-svelte/icons/search';
	import { enhance } from '$app/forms';
	import { Button, BaseDialog, FilterTabs, Select } from '$lib/components/ui';
	import { SentryIssuePicker } from '$lib/components/feature/sentry';
	import type { AdminIssueRow } from '$lib/server/issues';
	import type { SentryIssue } from '$lib/server/sentry';

	// Create/edit dialog for an issue. When `issue` is null it posts to ?/create; otherwise
	// ?/update (with a hidden id). Field values live in local state seeded by `seed()`, which
	// BaseDialog runs every time the dialog opens — so editing shows the issue's current data
	// (not blank) and a fresh "New issue" starts empty. Field NAMES carry the `issue-` prefix
	// to match the server parser (parseIssueInput).
	//
	// A NEW incident can also be sourced from a Sentry error via the mode toggle: pick one of the
	// unresolved Sentry issues (in the SentryIssuePicker sub-page) and it's tracked as a
	// source='sentry' incident — the convenience path so a manager needn't hop to /sentry. ponytail:
	// sentry mode reuses the existing /sentry?/track action (cross-route form post), not a copy here.
	let {
		open = $bindable(false),
		issue = null,
		staff,
		networks,
		sentryIssues = [],
		sentryConfigured = false
	}: {
		open?: boolean;
		issue?: AdminIssueRow | null;
		staff: { id: string; name: string; roleLabel: string }[];
		networks: { id: string; name: string }[];
		sentryIssues?: SentryIssue[];
		sentryConfigured?: boolean;
	} = $props();

	const inputClass =
		'min-h-11 w-full rounded-lg border border-border bg-bg px-4 py-3 text-sm text-ink transition-[border-color,box-shadow] duration-150 hover:border-brand/40 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none';

	const priorityOptions = [
		{ value: 'low', label: 'Low' },
		{ value: 'medium', label: 'Medium' },
		{ value: 'high', label: 'High' }
	];
	const apOptions = $derived([
		{ value: '', label: 'General (no access point)' },
		...networks.map((n) => ({ value: n.id, label: n.name }))
	]);

	// 'human' → manual incident; 'sentry' → track an unresolved Sentry error. The toggle only
	// shows on a NEW incident (an existing incident's source is immutable), and only when Sentry
	// is configured — otherwise the modal is manual-only, as before.
	let mode = $state<'human' | 'sentry'>('human');
	// In sentry mode, `picking` swaps the whole modal body for the SentryIssuePicker "page".
	let picking = $state(false);

	// Live form state (seeded from `issue` on open).
	let title = $state('');
	let description = $state('');
	let priority = $state('medium');
	let networkId = $state('');
	let dueDate = $state('');
	let assignees = $state<string[]>([]);
	let sentryIssueId = $state('');
	let error = $state('');
	let submitting = $state(false);

	const selectedSentry = $derived(sentryIssues.find((s) => s.id === sentryIssueId) ?? null);

	// Re-seed every time the dialog opens (BaseDialog calls this in its open effect, after the
	// parent has set `issue`). Blank fields for create, the issue's values for edit.
	function seed() {
		mode = 'human';
		picking = false;
		title = issue?.title ?? '';
		description = issue?.description ?? '';
		priority = issue?.priority ?? 'medium';
		networkId = issue?.networkId != null ? String(issue.networkId) : '';
		dueDate = issue?.dueDateInput ?? '';
		assignees = (issue?.assignees ?? []).map((a) => a.id);
		sentryIssueId = '';
		error = '';
	}

	// Picking a Sentry issue from the in-modal table: snapshot it, prefill the title (still
	// editable), and return to the form.
	function onPickSentry(picked: SentryIssue) {
		sentryIssueId = picked.id;
		title = picked.title;
		picking = false;
	}

	function toggleAssignee(id: string, checked: boolean) {
		assignees = checked ? [...assignees, id] : assignees.filter((a) => a !== id);
	}

	// Today as YYYY-MM-DD, so the date picker can't select a past deadline. When editing an
	// incident whose due date is already in the past, keep that value selectable (don't clamp
	// the min above it) — the server grandfathers an unchanged past date.
	const today = new Date().toLocaleDateString('en-CA'); // en-CA → ISO-ish YYYY-MM-DD
	const minDue = $derived(dueDate && dueDate < today ? dueDate : today);

	// Manual → ?/create|?/update on this route; sentry → the shared tracking action on /sentry.
	const formAction = $derived(
		issue ? '?/update' : mode === 'sentry' ? '/sentry?/track' : '?/create'
	);
	const submitLabel = $derived(
		issue ? 'Save changes' : mode === 'sentry' ? 'Track as incident' : 'Create incident'
	);
	const isSentry = $derived(!issue && mode === 'sentry');
</script>

<BaseDialog bind:open reset={seed} class="max-w-3xl">
	{#if isSentry && picking}
		<!-- The picker takes over the whole modal as its own "page"; onselect returns to the form. -->
		<SentryIssuePicker
			issues={sentryIssues}
			selectedId={sentryIssueId || null}
			onselect={onPickSentry}
			onback={() => (picking = false)}
		/>
	{:else}
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex min-w-0 items-center gap-3">
				<span
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand"
					aria-hidden="true"
				>
					{#if isSentry}
						<ClipboardPlus class="h-5 w-5" />
					{:else}
						<ClipboardList class="h-5 w-5" />
					{/if}
				</span>
				<div class="min-w-0">
					<h2 class="font-semibold text-ink">
						{issue ? 'Edit incident' : isSentry ? 'Track Sentry issue' : 'New incident'}
					</h2>
					<p class="text-xs text-muted">
						{#if isSentry}
							Track a Sentry error as an assigned incident
						{:else}
							Describe the problem, link an AP, and assign it to staff
						{/if}
					</p>
				</div>
			</div>

			{#if !issue && sentryConfigured}
				<!-- Source toggle — only on a new incident (source is immutable once created). Sits on the
				     header row, right-aligned; wraps under the title on narrow screens. -->
				<FilterTabs
					tabs={[
						{ key: 'human', label: 'Manual incident' },
						{ key: 'sentry', label: 'Sentry issue' }
					]}
					active={mode}
					onselect={(k) => (mode = k)}
				/>
			{/if}
		</div>

		<form
			class="mt-4 space-y-4"
			method="post"
			action={formAction}
			use:enhance={() => {
				submitting = true;
				return async ({ result, update }) => {
					if (result.type === 'success') {
						error = '';
						await update();
						open = false;
					} else if (result.type === 'failure') {
						error = (result.data?.error as string) ?? 'Could not save the incident.';
						await update({ reset: false });
					} else {
						await update();
					}
					submitting = false;
				};
			}}
		>
			{#if issue}
				<input type="hidden" name="id" value={issue.id} />
			{/if}
			{#if isSentry && selectedSentry}
				<!-- Snapshot fields read by createIssueFromSentry (id is the sentryIssueId input below). -->
				<input type="hidden" name="sentryShortId" value={selectedSentry.shortId} />
				<input type="hidden" name="sentryPermalink" value={selectedSentry.permalink} />
				<input type="hidden" name="sentryTitle" value={selectedSentry.title} />
			{/if}

			<div class="grid gap-4 md:grid-cols-2">
				<!-- Left column: what the incident is about. -->
				<div class="space-y-4">
					{#if isSentry}
						<!-- Hidden field carries the chosen issue's id (the picker sets it via onPickSentry). -->
						<input type="hidden" name="sentryIssueId" value={sentryIssueId} />
						<div class="space-y-1.5">
							<span class="block text-sm font-medium text-ink">Sentry issue</span>
							{#if sentryIssues.length === 0}
								<p class="text-xs text-muted">No unresolved Sentry issues to track right now.</p>
							{:else if selectedSentry}
								<div class="space-y-1 rounded-lg border border-border bg-surface p-3">
									<div class="flex items-center justify-between gap-2">
										<span class="font-mono text-xs text-muted">{selectedSentry.shortId}</span>
										<button
											type="button"
											onclick={() => (picking = true)}
											class="shrink-0 text-xs font-medium text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
										>
											Change
										</button>
									</div>
									<p class="font-mono text-sm break-words text-ink">{selectedSentry.title}</p>
									{#if selectedSentry.permalink}
										<!-- absolute external Sentry URL — resolve() (internal paths) doesn't apply. -->
										<!-- eslint-disable svelte/no-navigation-without-resolve -->
										<a
											href={selectedSentry.permalink}
											target="_blank"
											rel="noopener noreferrer"
											class="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
										>
											Open in Sentry <ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
										</a>
										<!-- eslint-enable svelte/no-navigation-without-resolve -->
									{/if}
								</div>
							{:else}
								<button
									type="button"
									onclick={() => (picking = true)}
									class="flex min-h-11 w-full items-center gap-2 rounded-lg border border-dashed border-border bg-bg px-4 py-3 text-left text-sm text-muted transition-colors hover:border-brand/40 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
								>
									<Search class="h-4 w-4 shrink-0" aria-hidden="true" />
									Select a Sentry issue…
								</button>
							{/if}
						</div>

						<div class="space-y-1.5">
							<label for="issue-title" class="block text-sm font-medium text-ink">Incident title</label>
							<input
								id="issue-title"
								name="issue-title"
								bind:value={title}
								required
								maxlength={200}
								placeholder="Short summary for the incident"
								class={inputClass}
							/>
						</div>
					{:else}
						<div class="space-y-1.5">
							<label for="issue-title" class="block text-sm font-medium text-ink">Title</label>
							<input
								id="issue-title"
								name="issue-title"
								bind:value={title}
								required
								maxlength={200}
								placeholder="Short summary (e.g. Pabayo AP offline)"
								class={inputClass}
							/>
						</div>

						<div class="space-y-1.5">
							<label for="issue-description" class="block text-sm font-medium text-ink">Description</label>
							<textarea
								id="issue-description"
								name="issue-description"
								rows="5"
								bind:value={description}
								class={inputClass}
								placeholder="What's wrong? Steps, symptoms, context…"
							></textarea>
						</div>
					{/if}
				</div>

				<!-- Right column: the incident metadata (assignment, priority, timing). -->
				<div class="space-y-4">
					<div class="grid gap-4 sm:grid-cols-2">
						<Select id="issue-priority" label="Priority" options={priorityOptions} bind:value={priority} />
						{#if isSentry}
							<div class="space-y-1.5">
								<label for="issue-dueDate" class="block text-sm font-medium text-ink">Due date</label>
								<input
									id="issue-dueDate"
									name="issue-dueDate"
									type="date"
									min={minDue}
									bind:value={dueDate}
									class={inputClass}
								/>
							</div>
						{:else}
							<Select id="issue-networkId" label="Access point" options={apOptions} bind:value={networkId} />
						{/if}
					</div>

					{#if !isSentry}
						<div class="space-y-1.5">
							<label for="issue-dueDate" class="block text-sm font-medium text-ink">Due date (optional)</label>
							<input
								id="issue-dueDate"
								name="issue-dueDate"
								type="date"
								min={minDue}
								bind:value={dueDate}
								class={inputClass}
							/>
						</div>
					{/if}

					<fieldset class="space-y-1.5">
						<legend class="block text-sm font-medium text-ink">Assign to</legend>
						{#if staff.length === 0}
							<p class="text-xs text-muted">No active staff to assign.</p>
						{:else}
							<div class="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
								{#each staff as s (s.id)}
									<label class="flex min-h-11 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface">
										<input
											type="checkbox"
											name="assigneeId"
											value={s.id}
											checked={assignees.includes(s.id)}
											onchange={(e) => toggleAssignee(s.id, e.currentTarget.checked)}
											class="h-4 w-4 rounded border-border text-brand focus:ring-brand/30"
										/>
										<span class="text-sm text-ink">{s.name}</span>
										<span class="ml-auto text-xs text-muted">{s.roleLabel}</span>
									</label>
								{/each}
							</div>
						{/if}
					</fieldset>
				</div>
			</div>

			{#if error}
				<p class="animate-fade-in-up text-sm text-blocked" role="alert">{error}</p>
			{/if}

			<div class="flex justify-end gap-2 border-t border-border pt-4">
				<Button type="button" variant="secondary" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" loading={submitting} disabled={isSentry && !sentryIssueId}>
					{submitLabel}
				</Button>
			</div>
		</form>
	{/if}
</BaseDialog>
