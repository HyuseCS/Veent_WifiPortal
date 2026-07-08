<script lang="ts">
	import ClipboardList from 'lucide-svelte/icons/clipboard-list';
	import { enhance } from '$app/forms';
	import { Button, BaseDialog, Select } from '$lib/components/ui';
	import type { AdminIssueRow } from '$lib/server/issues';

	// Create/edit dialog for an issue. When `issue` is null it posts to ?/create; otherwise
	// ?/update (with a hidden id). Field values live in local state seeded by `seed()`, which
	// BaseDialog runs every time the dialog opens — so editing shows the issue's current data
	// (not blank) and a fresh "New issue" starts empty. Field NAMES carry the `issue-` prefix
	// to match the server parser (parseIssueInput).
	let {
		open = $bindable(false),
		issue = null,
		staff,
		networks
	}: {
		open?: boolean;
		issue?: AdminIssueRow | null;
		staff: { id: string; name: string; roleLabel: string }[];
		networks: { id: string; name: string }[];
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

	// Live form state (seeded from `issue` on open).
	let title = $state('');
	let description = $state('');
	let priority = $state('medium');
	let networkId = $state('');
	let dueDate = $state('');
	let assignees = $state<string[]>([]);
	let error = $state('');
	let submitting = $state(false);

	// Re-seed every time the dialog opens (BaseDialog calls this in its open effect, after the
	// parent has set `issue`). Blank fields for create, the issue's values for edit.
	function seed() {
		title = issue?.title ?? '';
		description = issue?.description ?? '';
		priority = issue?.priority ?? 'medium';
		networkId = issue?.networkId != null ? String(issue.networkId) : '';
		dueDate = issue?.dueDateInput ?? '';
		assignees = (issue?.assignees ?? []).map((a) => a.id);
		error = '';
	}

	function toggleAssignee(id: string, checked: boolean) {
		assignees = checked ? [...assignees, id] : assignees.filter((a) => a !== id);
	}

	// Today as YYYY-MM-DD, so the date picker can't select a past deadline. When editing an
	// incident whose due date is already in the past, keep that value selectable (don't clamp
	// the min above it) — the server grandfathers an unchanged past date.
	const today = new Date().toLocaleDateString('en-CA'); // en-CA → ISO-ish YYYY-MM-DD
	const minDue = $derived(dueDate && dueDate < today ? dueDate : today);
</script>

<BaseDialog bind:open reset={seed} class="max-w-lg">
	<div class="flex items-center gap-3">
		<span
			class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand"
			aria-hidden="true"
		>
			<ClipboardList class="h-5 w-5" />
		</span>
		<div class="min-w-0">
			<h2 class="font-semibold text-ink">{issue ? 'Edit incident' : 'New incident'}</h2>
			<p class="text-xs text-muted">Describe the problem, link an AP, and assign it to staff</p>
		</div>
	</div>

	<form
		class="mt-4 space-y-4"
		method="post"
		action={issue ? '?/update' : '?/create'}
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
				rows="3"
				bind:value={description}
				class={inputClass}
				placeholder="What's wrong? Steps, symptoms, context…"
			></textarea>
		</div>

		<div class="grid gap-4 sm:grid-cols-2">
			<Select id="issue-priority" label="Priority" options={priorityOptions} bind:value={priority} />
			<Select id="issue-networkId" label="Access point" options={apOptions} bind:value={networkId} />
		</div>

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

		<fieldset class="space-y-1.5">
			<legend class="block text-sm font-medium text-ink">Assign to</legend>
			{#if staff.length === 0}
				<p class="text-xs text-muted">No active staff to assign.</p>
			{:else}
				<div class="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
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

		{#if error}
			<p class="animate-fade-in-up text-sm text-blocked" role="alert">{error}</p>
		{/if}

		<div class="flex justify-end gap-2">
			<Button type="button" variant="secondary" onclick={() => (open = false)}>Cancel</Button>
			<Button type="submit" loading={submitting}>{issue ? 'Save changes' : 'Create issue'}</Button>
		</div>
	</form>
</BaseDialog>
