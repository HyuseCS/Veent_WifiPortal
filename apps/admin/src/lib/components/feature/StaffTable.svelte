<script lang="ts">
	import Ban from 'lucide-svelte/icons/ban';
	import Check from 'lucide-svelte/icons/check';
	import Crown from 'lucide-svelte/icons/crown';
	import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import X from 'lucide-svelte/icons/x';
	import type { Component } from 'svelte';
	import { enhance } from '$app/forms';
	import type { StaffMember, StaffStatus, StatusTone } from '$lib/types';
	import { IconButton, StatusBadge, Table } from '$lib/components/ui';

	// Presentational table for the owner-only Staff page. Row actions post directly to
	// the page's form actions (?/setStatus, ?/remove, ?/promote); the route enforces
	// owner access. The owner row itself shows no actions (it can't be disabled,
	// removed, or re-promoted).
	let { staff }: { staff: StaffMember[] } = $props();

	// Two-step inline confirm for the privileged actions — avoids a Modal primitive.
	let confirmingId = $state<string | null>(null); // remove
	let promotingId = $state<string | null>(null); // give owner role

	const columns = [
		{ label: 'Member' },
		{ label: 'Role' },
		{ label: 'Status' },
		{ label: 'Last active' },
		{ label: 'Actions', srOnly: true }
	];

	const statusMeta: Record<StaffStatus, { tone: StatusTone; label: string }> = {
		active: { tone: 'online', label: 'Active' },
		pending: { tone: 'warning', label: 'Invitation sent' },
		disabled: { tone: 'blocked', label: 'Disabled' }
	};
</script>

<Table {columns}>
	{#each staff as member (member.id)}
		<tr class="transition-colors hover:bg-surface">
			<td class="px-4 py-3">
				<div class="font-medium text-ink">{member.name}</div>
				<div class="font-mono text-xs text-muted">{member.email}</div>
			</td>
			<td class="px-4 py-3">
				{#if member.role === 'owner'}
					<span
						class="inline-flex items-center rounded-full bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand"
					>
						{member.roleLabel}
					</span>
				{:else}
					<span
						class="inline-flex items-center rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-ink"
					>
						{member.roleLabel}
					</span>
				{/if}
			</td>
			<td class="px-4 py-3">
				<StatusBadge tone={statusMeta[member.status].tone} label={statusMeta[member.status].label} />
			</td>
			<td class="px-4 py-3 font-mono text-muted">{member.lastActive}</td>
			<td class="px-4 py-3">
				{#if member.role !== 'owner'}
					{#if confirmingId === member.id}
						<div class="flex items-center justify-end gap-1">
							<span class="text-xs text-muted">Remove {member.name}?</span>
							<form method="post" action="?/remove" use:enhance={() => async ({ update }) => {
									confirmingId = null;
									await update();
								}}>
								<input type="hidden" name="userId" value={member.id} />
								<IconButton
									type="submit"
									icon={Check as unknown as Component}
									label="Confirm removing {member.name}"
									tone="danger"
								/>
							</form>
							<IconButton
								icon={X as unknown as Component}
								label="Cancel"
								onclick={() => (confirmingId = null)}
							/>
						</div>
					{:else if promotingId === member.id}
						<div class="flex items-center justify-end gap-1">
							<span class="text-xs text-muted">Make {member.name} an owner?</span>
							<form method="post" action="?/promote" use:enhance={() => async ({ update }) => {
									promotingId = null;
									await update();
								}}>
								<input type="hidden" name="userId" value={member.id} />
								<IconButton
									type="submit"
									icon={Check as unknown as Component}
									label="Confirm promoting {member.name} to owner"
								/>
							</form>
							<IconButton
								icon={X as unknown as Component}
								label="Cancel"
								onclick={() => (promotingId = null)}
							/>
						</div>
					{:else}
						<div class="flex items-center justify-end gap-1">
							{#if member.role === 'admin' && member.status === 'active'}
								<IconButton
									icon={Crown as unknown as Component}
									label="Give {member.name} the owner role"
									onclick={() => (promotingId = member.id)}
								/>
							{/if}
							{#if member.status === 'disabled'}
								<form method="post" action="?/setStatus" use:enhance>
									<input type="hidden" name="userId" value={member.id} />
									<input type="hidden" name="status" value="active" />
									<IconButton
										type="submit"
										icon={RotateCcw as unknown as Component}
										label="Reactivate {member.name}"
									/>
								</form>
							{:else}
								<form method="post" action="?/setStatus" use:enhance>
									<input type="hidden" name="userId" value={member.id} />
									<input type="hidden" name="status" value="disabled" />
									<IconButton
										type="submit"
										icon={Ban as unknown as Component}
										label="Suspend {member.name}"
										tone="danger"
									/>
								</form>
							{/if}
							<IconButton
								icon={Trash2 as unknown as Component}
								label="Remove {member.name}"
								tone="danger"
								onclick={() => (confirmingId = member.id)}
							/>
						</div>
					{/if}
				{/if}
			</td>
		</tr>
	{/each}
</Table>
