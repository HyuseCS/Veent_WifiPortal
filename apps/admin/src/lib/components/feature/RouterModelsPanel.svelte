<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Plus from 'lucide-svelte/icons/plus';
	import Pencil from 'lucide-svelte/icons/pencil';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import RouterIcon from 'lucide-svelte/icons/router';
	import { Card, Button } from '$lib/components/ui';

	// One catalog row + its usage count (matches listRouterModels). Kept structural so the
	// panel doesn't import from $lib/server.
	type ModelRow = {
		id: string;
		name: string;
		rangeMeters: number;
		sortOrder: number;
		usageCount: number;
	};
	// Just the fields this panel reads off the page's form action result. `id` is widened to
	// string | number because the page's other actions (setInterface/deleteNetwork) return a
	// numeric AP id; only the model actions set the string slug this panel matches on.
	type ModelForm = { action?: string; error?: string; id?: string | number } | null;

	let { models, form }: { models: ModelRow[]; form: ModelForm } = $props();

	// One of: adding a new model, editing an existing one's id, or confirming a delete. Mutually
	// exclusive — opening one closes the others.
	let adding = $state(false);
	let editingId = $state<string | null>(null);
	let confirmingId = $state<string | null>(null);

	function openAdd() {
		adding = true;
		editingId = null;
		confirmingId = null;
	}
	function openEdit(id: string) {
		editingId = id;
		adding = false;
		confirmingId = null;
	}
	function closeAll() {
		adding = false;
		editingId = null;
		confirmingId = null;
	}

	// Error from the last action, shown against the form it came from (add vs a specific row).
	const errFor = (action: string, id?: string) =>
		form?.error && form.action === action && (id === undefined || form.id === id)
			? form.error
			: '';

	// On success: close the open form and reload (fresh catalog + usage counts). On failure:
	// keep the form open and surface the server error via `form` without clearing inputs.
	const onResult: SubmitFunction = () => async ({ result, update }) => {
		if (result.type === 'success') {
			closeAll();
			await update();
		} else {
			await update({ reset: false });
		}
	};

	const inputClass =
		'min-h-11 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink transition-[border-color,box-shadow] duration-150 hover:border-brand/40 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none';
</script>

<Card class="flex flex-col gap-4">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h2 class="text-base font-semibold text-ink">Router Models</h2>
			<p class="mt-0.5 text-xs text-muted">
				Advertised coverage range per AP model. Editing a range re-sizes every AP on that model
				that has no manual override.
			</p>
		</div>
		<Button variant="secondary" onclick={openAdd} disabled={adding}>
			<Plus class="h-4 w-4" aria-hidden="true" /> Add model
		</Button>
	</div>

	<!-- Add form -->
	{#if adding}
		<form
			method="post"
			action="?/addModel"
			use:enhance={onResult}
			class="space-y-2 rounded-lg border border-brand/30 bg-surface p-3"
		>
			<div class="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
				<input name="id" placeholder="model-id (slug)" autocomplete="off" class={inputClass} />
				<input name="name" placeholder="Display name" autocomplete="off" class={inputClass} />
				<input
					name="rangeMeters"
					type="number"
					min="10"
					max="5000"
					placeholder="Range (m)"
					class="{inputClass} sm:w-32"
				/>
			</div>
			{#if errFor('addModel')}
				<p class="text-xs text-blocked" role="alert">{errFor('addModel')}</p>
			{/if}
			<div class="flex justify-end gap-2">
				<Button type="button" variant="secondary" onclick={closeAll}>Cancel</Button>
				<Button type="submit">Add model</Button>
			</div>
		</form>
	{/if}

	<!-- Catalog list -->
	<ul class="divide-y divide-border rounded-lg border border-border">
		{#each models as m (m.id)}
			<li class="p-3">
				{#if editingId === m.id}
					<!-- Inline edit: id is immutable, so only name + range are editable. -->
					<form method="post" action="?/updateModel" use:enhance={onResult} class="space-y-2">
						<input type="hidden" name="id" value={m.id} />
						<div class="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
							<input name="name" value={m.name} autocomplete="off" class={inputClass} />
							<input
								name="rangeMeters"
								type="number"
								min="10"
								max="5000"
								value={m.rangeMeters}
								class="{inputClass} sm:w-32"
								aria-label="Range in metres"
							/>
							<div class="flex gap-2">
								<Button type="button" variant="secondary" onclick={closeAll}>Cancel</Button>
								<Button type="submit">Save</Button>
							</div>
						</div>
						<p class="font-mono text-xs text-muted">{m.id}</p>
						{#if errFor('updateModel', m.id)}
							<p class="text-xs text-blocked" role="alert">{errFor('updateModel', m.id)}</p>
						{/if}
					</form>
				{:else}
					<div class="flex items-center gap-3">
						<span
							class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand"
							aria-hidden="true"
						>
							<RouterIcon class="h-4.5 w-4.5" />
						</span>
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium text-ink">{m.name}</p>
							<p class="truncate text-xs text-muted">
								<span class="font-mono">{m.id}</span>
								· <span class="font-mono text-ink">{m.rangeMeters} m</span>
								· in use by {m.usageCount} AP{m.usageCount === 1 ? '' : 's'}
							</p>
						</div>
						<div class="flex shrink-0 items-center gap-1">
							<button
								type="button"
								onclick={() => openEdit(m.id)}
								class="flex h-9 w-9 items-center justify-center rounded text-muted hover:bg-surface hover:text-ink"
								aria-label="Edit {m.name}"
							>
								<Pencil class="h-4 w-4" aria-hidden="true" />
							</button>
							<button
								type="button"
								onclick={() => (confirmingId = confirmingId === m.id ? null : m.id)}
								disabled={models.length <= 1}
								title={models.length <= 1 ? 'Keep at least one model' : 'Delete model'}
								class="flex h-9 w-9 items-center justify-center rounded text-muted hover:bg-surface hover:text-blocked disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted"
								aria-label="Delete {m.name}"
							>
								<Trash2 class="h-4 w-4" aria-hidden="true" />
							</button>
						</div>
					</div>

					<!-- Inline delete confirm -->
					{#if confirmingId === m.id}
						<div
							class="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blocked/30 bg-blocked/5 p-2.5"
						>
							<p class="text-xs text-ink">
								Delete <span class="font-medium">{m.name}</span>?
								{#if m.usageCount > 0}
									{m.usageCount} AP{m.usageCount === 1 ? '' : 's'} will fall back to the default range.
								{/if}
							</p>
							<div class="flex gap-2">
								<button
									type="button"
									onclick={() => (confirmingId = null)}
									class="min-h-[36px] rounded border border-border px-3 text-xs font-medium text-ink hover:bg-surface"
								>
									Cancel
								</button>
								<form method="post" action="?/deleteModel" use:enhance={onResult}>
									<input type="hidden" name="id" value={m.id} />
									<button
										type="submit"
										class="min-h-[36px] rounded bg-blocked px-3 text-xs font-medium text-white hover:opacity-90"
									>
										Delete
									</button>
								</form>
							</div>
						</div>
					{/if}
					{#if errFor('deleteModel', m.id)}
						<p class="mt-2 text-xs text-blocked" role="alert">{errFor('deleteModel', m.id)}</p>
					{/if}
				{/if}
			</li>
		{/each}
	</ul>
</Card>
