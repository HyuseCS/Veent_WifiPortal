<script lang="ts">
	import { enhance } from '$app/forms';
	import { Card, Button, Field } from '$lib/components/ui';
	import StepUpDialog from '$lib/components/feature/StepUpDialog.svelte';
	import Plus from 'lucide-svelte/icons/plus';
	import Pencil from 'lucide-svelte/icons/pencil';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import X from 'lucide-svelte/icons/x';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Per-save MFA: the edit form collects the code inline; one-click toggle/delete route
	// through a step-up confirm dialog. The server re-verifies the code on every write.
	let code = $state('');
	const codeValid = $derived(/^\d{6}$/.test(code));

	let dialogOpen = $state(false);
	let dialogProps = $state<{
		title: string;
		message: string;
		action: string;
		fields: Record<string, string | number | boolean>;
		submitLabel: string;
		danger: boolean;
	}>({ title: '', message: '', action: '', fields: {}, submitLabel: 'Confirm', danger: false });

	function confirmToggle(p: Pkg) {
		dialogProps = {
			title: p.isActive ? `Deactivate ${p.name}` : `Activate ${p.name}`,
			message: p.isActive
				? 'This removes it from the customer apps. Enter your authenticator code to confirm.'
				: 'This makes it purchasable in the customer apps. Enter your authenticator code to confirm.',
			action: '?/toggleActive',
			fields: { id: p.id, isActive: (!p.isActive).toString() },
			submitLabel: p.isActive ? 'Deactivate' : 'Activate',
			danger: false
		};
		dialogOpen = true;
	}
	function confirmRemove(p: Pkg) {
		dialogProps = {
			title: `Delete ${p.name}`,
			message: "This permanently deletes the package and can't be undone. Enter your authenticator code to confirm.",
			action: '?/remove',
			fields: { id: p.id },
			submitLabel: 'Delete',
			danger: true
		};
		dialogOpen = true;
	}
	// Surface a step-up/validation error inside the dialog only when it belongs to the dialog
	// that's currently open — otherwise a failed `remove` would bleed into a freshly-opened
	// `toggleActive` dialog. `form` is a union of per-action shapes; for this presentation-only
	// check we just need an optional error + action, so read it through a loose view.
	const fv = $derived(form as { ok?: boolean; action?: string; error?: string } | null);
	const dialogError = $derived(
		fv?.error && dialogProps.action === `?/${fv.action}` ? fv.error : null
	);

	type Pkg = PageData['packages'][number];
	type EditState = {
		id: number | null;
		name: string;
		type: string;
		fiatCost: string;
		creditsProvided: string;
		creditCost: string;
		durationMinutes: string;
		isActive: boolean;
	};

	const blank = (): EditState => ({
		id: null,
		name: '',
		type: 'bundle',
		fiatCost: '',
		creditsProvided: '',
		creditCost: '',
		durationMinutes: '',
		isActive: true
	});

	// The package being created/edited; null = the form is closed.
	let editing = $state<EditState | null>(null);

	function startNew() {
		code = '';
		editing = blank();
	}
	function startEdit(p: Pkg) {
		code = '';
		editing = {
			id: p.id,
			name: p.name,
			type: p.type,
			fiatCost: p.fiatCost?.toString() ?? '',
			creditsProvided: p.creditsProvided?.toString() ?? '',
			creditCost: p.creditCost?.toString() ?? '',
			durationMinutes: p.durationMinutes?.toString() ?? '',
			isActive: p.isActive
		};
	}

	// Customer-facing groups, in the order a buyer meets them.
	const groups = $derived(
		[
			{ type: 'bundle', label: 'Credit Bundles', hint: 'Bought with pesos at top-up' },
			{ type: 'tier', label: 'Access Tiers', hint: 'Bought with credits on the dashboard' },
			{ type: 'free', label: 'Free Time', hint: 'The free access grant' }
		].map((g) => ({ ...g, items: data.packages.filter((p) => p.type === g.type) }))
	);

	// Close the form once a create/update lands.
	$effect(() => {
		if (form?.ok && (form.action === 'create' || form.action === 'update')) editing = null;
	});

	// Short, honest one-line summary of a package's economics for the row.
	function summary(p: Pkg): string {
		if (p.type === 'bundle') return `₱${p.fiatCost ?? '—'} → ${p.creditsProvided ?? '—'} credits`;
		if (p.type === 'tier')
			return `${p.creditCost ?? '—'} credits → ${p.durationMinutes ?? '—'} min`;
		return `${p.durationMinutes ?? '—'} min free`;
	}
</script>

<div class="space-y-5">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h2 class="text-base font-semibold text-ink">Packages</h2>
			<p class="mt-0.5 text-xs text-muted">
				What guests can buy. Toggling a package on/off adds or removes it from the customer apps.
			</p>
		</div>
		{#if !editing}
			<Button onclick={startNew}>
				<Plus class="h-4 w-4" aria-hidden="true" />
				New package
			</Button>
		{/if}
	</div>

	{#if fv?.error && (fv.action === 'create' || fv.action === 'update')}
		<p class="rounded-lg bg-blocked/10 px-4 py-3 text-sm text-blocked" role="alert">{fv.error}</p>
	{/if}

	{#if editing}
		<!-- Create / edit panel. Numeric fields show per type so an offer can't be half-configured. -->
		<Card>
			<form
				method="post"
				action={editing.id ? '?/update' : '?/create'}
				use:enhance
				class="flex flex-col gap-4"
			>
				<div class="flex items-center justify-between">
					<h3 class="text-sm font-semibold text-ink">
						{editing.id ? 'Edit package' : 'New package'}
					</h3>
					<button
						type="button"
						onclick={() => (editing = null)}
						class="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-ink"
						aria-label="Cancel"
					>
						<X class="h-4 w-4" />
					</button>
				</div>

				{#if editing.id}<input type="hidden" name="id" value={editing.id} />{/if}

				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<label class="flex flex-col gap-1.5 text-xs font-medium text-muted">
						Name
						<input
							name="name"
							bind:value={editing.name}
							required
							placeholder="e.g. ₱50 — 50 Credits"
							class="min-h-[44px] rounded-lg border border-border bg-bg px-3 text-sm text-ink"
						/>
					</label>

					<label class="flex flex-col gap-1.5 text-xs font-medium text-muted">
						Type
						<select
							name="type"
							bind:value={editing.type}
							class="min-h-[44px] rounded-lg border border-border bg-bg px-3 text-sm text-ink"
						>
							<option value="bundle">Credit Bundle (peso purchase)</option>
							<option value="tier">Access Tier (credit purchase)</option>
							<option value="free">Free Time</option>
						</select>
					</label>

					{#if editing.type === 'bundle'}
						<label class="flex flex-col gap-1.5 text-xs font-medium text-muted">
							Price (₱)
							<input
								name="fiatCost"
								type="number"
								min="0"
								step="0.01"
								bind:value={editing.fiatCost}
								class="min-h-[44px] rounded-lg border border-border bg-bg px-3 font-mono text-sm text-ink"
							/>
						</label>
						<label class="flex flex-col gap-1.5 text-xs font-medium text-muted">
							Credits provided
							<input
								name="creditsProvided"
								type="number"
								min="0"
								step="1"
								bind:value={editing.creditsProvided}
								class="min-h-[44px] rounded-lg border border-border bg-bg px-3 font-mono text-sm text-ink"
							/>
						</label>
					{:else if editing.type === 'tier'}
						<label class="flex flex-col gap-1.5 text-xs font-medium text-muted">
							Credit cost
							<input
								name="creditCost"
								type="number"
								min="0"
								step="1"
								bind:value={editing.creditCost}
								class="min-h-[44px] rounded-lg border border-border bg-bg px-3 font-mono text-sm text-ink"
							/>
						</label>
						<label class="flex flex-col gap-1.5 text-xs font-medium text-muted">
							Duration (minutes)
							<input
								name="durationMinutes"
								type="number"
								min="0"
								step="1"
								bind:value={editing.durationMinutes}
								class="min-h-[44px] rounded-lg border border-border bg-bg px-3 font-mono text-sm text-ink"
							/>
						</label>
					{:else}
						<label class="flex flex-col gap-1.5 text-xs font-medium text-muted">
							Duration (minutes)
							<input
								name="durationMinutes"
								type="number"
								min="0"
								step="1"
								bind:value={editing.durationMinutes}
								class="min-h-[44px] rounded-lg border border-border bg-bg px-3 font-mono text-sm text-ink"
							/>
						</label>
					{/if}
				</div>

				<label class="flex items-center gap-2.5 text-sm text-ink">
					<input type="checkbox" name="isActive" bind:checked={editing.isActive} class="h-4 w-4" />
					Active — visible to guests
				</label>

				<Field
					id="package-code"
					name="code"
					label="Authenticator code"
					inputmode="numeric"
					autocomplete="one-time-code"
					placeholder="6-digit code"
					value={code}
					oninput={(e) => (code = e.currentTarget.value)}
					class="max-w-40 font-mono tracking-widest"
				/>

				<div class="flex gap-2.5">
					<Button type="submit" disabled={!codeValid}>
						{editing.id ? 'Save changes' : 'Create package'}
					</Button>
					<Button variant="secondary" onclick={() => (editing = null)}>Cancel</Button>
				</div>
			</form>
		</Card>
	{/if}

	{#each groups as group (group.type)}
		<Card class="flex flex-col gap-3">
			<div>
				<h3 class="text-sm font-semibold text-ink">{group.label}</h3>
				<p class="text-xs text-muted">{group.hint}</p>
			</div>

			{#if group.items.length === 0}
				<p class="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted">
					No {group.label.toLowerCase()} yet.
				</p>
			{:else}
				<ul class="flex flex-col divide-y divide-border">
					{#each group.items as p (p.id)}
						<li class="flex flex-wrap items-center gap-3 py-3">
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span class="truncate text-sm font-medium text-ink">{p.name}</span>
									{#if !p.isActive}
										<span
											class="rounded-full bg-surface px-2 py-0.5 text-[10px] font-bold tracking-wide text-muted uppercase"
											>Inactive</span
										>
									{/if}
								</div>
								<span class="font-mono text-xs text-muted">{summary(p)}</span>
							</div>

							<button
								type="button"
								onclick={() => confirmToggle(p)}
								class="flex min-h-[44px] items-center rounded-lg border border-border px-3 text-xs font-semibold text-muted hover:text-ink"
							>
								{p.isActive ? 'Deactivate' : 'Activate'}
							</button>

							<button
								type="button"
								onclick={() => startEdit(p)}
								class="flex h-11 w-11 items-center justify-center rounded-lg border border-border text-muted hover:text-ink"
								aria-label="Edit {p.name}"
							>
								<Pencil class="h-4 w-4" />
							</button>

							<button
								type="button"
								onclick={() => confirmRemove(p)}
								class="flex h-11 w-11 items-center justify-center rounded-lg border border-border text-blocked hover:bg-blocked/10"
								aria-label="Delete {p.name}"
							>
								<Trash2 class="h-4 w-4" />
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>
	{/each}

	<StepUpDialog
		bind:open={dialogOpen}
		title={dialogProps.title}
		message={dialogProps.message}
		action={dialogProps.action}
		fields={dialogProps.fields}
		submitLabel={dialogProps.submitLabel}
		danger={dialogProps.danger}
		error={dialogError}
	/>
</div>
