<script lang="ts">
	import Ban from 'lucide-svelte/icons/ban';
	import Check from 'lucide-svelte/icons/check';
	import Crown from 'lucide-svelte/icons/crown';
	import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
	import Search from 'lucide-svelte/icons/search';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import X from 'lucide-svelte/icons/x';
	import type { Component } from 'svelte';
	import { enhance } from '$app/forms';
	import type { StaffMember, StaffStatus, StatusTone } from '$lib/types';
	import {
		EmptyState,
		FilterTabs,
		IconButton,
		SearchInput,
		StatusBadge,
		Table
	} from '$lib/components/ui';

	// Presentational table for the owner-only Staff page. Row actions post directly to
	// the page's form actions (?/setStatus, ?/remove, ?/promote); the route enforces
	// owner access. The owner row itself shows no actions (it can't be disabled,
	// removed, or re-promoted). Search + status filter run client-side over the
	// already-loaded `staff` (no extra loads), mirroring <UsersTable>/<TransactionsTable>.
	let { staff }: { staff: StaffMember[] } = $props();

	// Two-step inline confirm for the privileged actions — avoids a Modal primitive.
	let confirmingId = $state<string | null>(null); // remove
	let promotingId = $state<string | null>(null); // give owner role

	// Client-side view state over the loaded rows: a text query + a status filter.
	let query = $state('');
	let filter = $state<'all' | StaffStatus>('all');

	// Status filter pills with live counts off the full set (counts stay stable as you filter).
	const statusCount = (status: StaffStatus) => staff.filter((m) => m.status === status).length;
	const tabs = $derived([
		{ key: 'all' as const, label: 'All', count: staff.length },
		{ key: 'active' as const, label: 'Active', count: statusCount('active') },
		{ key: 'pending' as const, label: 'Invited', count: statusCount('pending') },
		{ key: 'disabled' as const, label: 'Disabled', count: statusCount('disabled') }
	]);

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		let rows = staff.filter((m) => filter === 'all' || m.status === filter);
		if (q) rows = rows.filter((m) => `${m.name} ${m.email}`.toLowerCase().includes(q));
		return rows;
	});

	// First two letters of the name, for the avatar chip (shared visual with <UsersTable>).
	const initials = (name: string) =>
		name
			.split(' ')
			.map((w) => w[0])
			.slice(0, 2)
			.join('')
			.toUpperCase();

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
	<!-- Toolbar: title + status filter + search, matching the Users/Transactions chrome. -->
	{#snippet toolbar()}
		<div class="flex flex-wrap items-center gap-3 px-4 py-3">
			<h2 class="text-base font-semibold text-ink">Members</h2>
			<FilterTabs {tabs} active={filter} onselect={(key) => (filter = key)} />
			<SearchInput
				bind:value={query}
				placeholder="Search name or email…"
				label="Search staff"
				class="ml-auto min-w-60 flex-1 sm:max-w-xs"
			/>
		</div>
	{/snippet}

	{#each filtered as member (member.id)}
		<tr class="hover:bg-surface" class:opacity-60={member.status === 'disabled'}>
			<td class="px-4 py-3">
				<div class="flex items-center gap-3">
					<span
						class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand"
						aria-hidden="true">{initials(member.name)}</span
					>
					<div class="min-w-0">
						<div class="truncate font-medium text-ink">{member.name}</div>
						<div class="truncate font-mono text-xs text-muted">{member.email}</div>
					</div>
				</div>
			</td>
			<td class="px-4 py-3">
				{#if member.role === 'owner'}
					<span
						class="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand"
					>
						<Crown class="h-3.5 w-3.5" aria-hidden="true" />
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
				<StatusBadge
					tone={statusMeta[member.status].tone}
					label={statusMeta[member.status].label}
				/>
			</td>
			<td class="px-4 py-3 font-mono text-muted">{member.lastActive}</td>
			<td class="px-4 py-3">
				{#if member.role !== 'owner'}
					{#if confirmingId === member.id}
						<div class="flex items-center justify-end gap-1">
							<span class="text-xs text-muted">Remove {member.name}?</span>
							<form
								method="post"
								action="?/remove"
								use:enhance={() =>
									async ({ update }) => {
										confirmingId = null;
										await update();
									}}
							>
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
							<form
								method="post"
								action="?/promote"
								use:enhance={() =>
									async ({ update }) => {
										promotingId = null;
										await update();
									}}
							>
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

	{#if filtered.length === 0}
		<tr>
			<td colspan={columns.length} class="p-0">
				<EmptyState
					icon={Search as unknown as Component}
					title="No staff members match"
					description="Try a different search term or status filter."
					compact
				/>
			</td>
		</tr>
	{/if}

	<!-- Footer: live count of what's shown vs. the full staff list. -->
	{#snippet footer()}
		<p class="px-4 py-3 text-xs text-muted">
			Showing {filtered.length} of {staff.length} staff members
		</p>
	{/snippet}
</Table>
