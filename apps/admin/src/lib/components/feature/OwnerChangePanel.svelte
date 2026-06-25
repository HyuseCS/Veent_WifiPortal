<script lang="ts">
	import ShieldAlert from 'lucide-svelte/icons/shield-alert';
	import { enhance } from '$app/forms';
	import { Button, Field, StatusBadge } from '$lib/components/ui';
	import type { OwnerChangeRequest } from '$lib/types';

	// Pending owner demotion/removal requests. Each needs unanimous approval from all
	// other owners; this owner approves with a TOTP step-up, or cancels a request they
	// opened. Shown only when there are open requests.
	let {
		requests,
		currentUserId,
		form
	}: {
		requests: OwnerChangeRequest[];
		currentUserId: string;
		form?: { error?: string; action?: string } | null;
	} = $props();

	const verb = (a: OwnerChangeRequest['action']) =>
		a === 'demote' ? 'Demote to admin' : 'Remove';

	// Can this owner still cast an approval on a given request?
	const canApprove = (r: OwnerChangeRequest) =>
		!r.expired &&
		r.requiredOwnerIds.includes(currentUserId) &&
		!r.approvedOwnerIds.includes(currentUserId);

	// Approve modal state (shared, bound to the selected request).
	let el = $state<HTMLDialogElement>();
	let selected = $state<OwnerChangeRequest | null>(null);
	let code = $state('');

	function openApprove(r: OwnerChangeRequest) {
		selected = r;
		code = '';
		el?.showModal();
	}
</script>

{#if requests.length > 0}
	<section class="shrink-0 space-y-3 rounded-xl border border-warning/40 bg-warning/5 p-4">
		<div class="flex items-center gap-2">
			<ShieldAlert class="h-4 w-4 text-warning" aria-hidden="true" />
			<h2 class="text-sm font-semibold text-ink">Pending owner changes</h2>
		</div>

		<ul class="space-y-2">
			{#each requests as r (r.id)}
				<li class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-bg px-4 py-3">
					<div class="space-y-0.5">
						<p class="text-sm text-ink">
							<strong>{verb(r.action)}</strong>
							{r.targetName}
						</p>
						<p class="text-xs text-muted">
							Requested by {r.initiatedByName} ·
							<span class="font-mono">{r.approvedOwnerIds.length}</span> of
							<span class="font-mono">{r.requiredOwnerIds.length}</span> owners approved
						</p>
					</div>

					<div class="flex items-center gap-2">
						{#if r.expired}
							<StatusBadge tone="blocked" label="Expired" />
						{:else if canApprove(r)}
							<Button variant="primary" onclick={() => openApprove(r)}>Approve</Button>
						{:else if r.approvedOwnerIds.includes(currentUserId)}
							<StatusBadge tone="online" label="You approved" />
						{/if}

						{#if r.initiatedById === currentUserId}
							<form
								method="post"
								action="?/cancelOwnerChange"
								use:enhance={() => async ({ update }) => update({ reset: false })}
							>
								<input type="hidden" name="requestId" value={r.id} />
								<Button type="submit" variant="secondary">Cancel</Button>
							</form>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	</section>

	<!-- Approve step-up: owner re-enters their TOTP to cast the approval. -->
	<dialog
		bind:this={el}
		onclose={() => (selected = null)}
		class="m-auto w-full max-w-sm rounded-lg border border-border bg-bg p-6 text-ink backdrop:bg-black/50"
	>
		{#if selected}
			<h2 class="text-lg font-semibold text-ink">Approve owner change</h2>
			<p class="mt-2 text-sm text-muted">
				Confirm <strong>{verb(selected.action).toLowerCase()} {selected.targetName}</strong>. Once
				every owner approves, it takes effect immediately.
			</p>

			<form
				method="post"
				action="?/approveOwnerChange"
				use:enhance={() =>
					({ update, result }) => {
						if (result.type === 'success') el?.close();
						return update({ reset: false });
					}}
				class="mt-4 space-y-3"
			>
				<input type="hidden" name="requestId" value={selected.id} />
				<Field
					id="approve-code"
					name="code"
					label="Your authenticator code"
					inputmode="numeric"
					autocomplete="one-time-code"
					value={code}
					oninput={(e) => (code = e.currentTarget.value)}
					class="font-mono tracking-widest"
				/>

				{#if form?.error && form?.action === 'approveOwnerChange'}
					<p class="text-sm text-blocked" role="alert">{form.error}</p>
				{/if}

				<div class="flex justify-end gap-2">
					<Button type="button" variant="secondary" onclick={() => el?.close()}>Cancel</Button>
					<Button type="submit" variant="danger-solid" disabled={!/^\d{6}$/.test(code)}>
						Approve
					</Button>
				</div>
			</form>
		{/if}
	</dialog>
{/if}
