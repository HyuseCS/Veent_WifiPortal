<script lang="ts">
	import Ban from 'lucide-svelte/icons/ban';
	import Check from 'lucide-svelte/icons/check';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ChevronUp from 'lucide-svelte/icons/chevron-up';
	import ChevronsUpDown from 'lucide-svelte/icons/chevrons-up-down';
	import Crown from 'lucide-svelte/icons/crown';
	import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
	import Search from 'lucide-svelte/icons/search';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import UserPlus from 'lucide-svelte/icons/user-plus';
	import X from 'lucide-svelte/icons/x';
	import type { Component } from 'svelte';
	import { enhance } from '$app/forms';
	import type { StaffMember, StaffStatus, StatusTone } from '$lib/types';
	import {
		Button,
		EmptyState,
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
	let { staff, onadd }: { staff: StaffMember[]; onadd?: () => void } = $props();

	// Two-step inline confirm for the privileged actions — avoids a Modal primitive.
	let confirmingId = $state<string | null>(null); // remove
	let promotingId = $state<string | null>(null); // give owner role

	// Client-side text search over the loaded rows (status is reachable via the Status column
	// sorter now, so the old status-filter pills were dropped from the toolbar).
	let query = $state('');

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return staff;
		return staff.filter((m) => `${m.name} ${m.email}`.toLowerCase().includes(q));
	});

	// Clickable-header sorting. `null` key keeps the server order (owner pinned first, then
	// alphabetical). Clicking a header sorts by it; clicking the active header flips direction.
	type SortKey = 'name' | 'role' | 'status' | 'lastActive';
	let sortKey = $state<SortKey | null>(null);
	let sortDir = $state<'asc' | 'desc'>('asc');
	// Sensible first-click direction per column (most-recent-active first feels natural).
	const defaultDir: Record<SortKey, 'asc' | 'desc'> = {
		name: 'asc',
		role: 'asc',
		status: 'asc',
		lastActive: 'desc'
	};
	// Logical status order (not alphabetical) so sorting groups by lifecycle stage.
	const statusRank: Record<StaffStatus, number> = { active: 0, pending: 1, disabled: 2 };

	function toggleSort(key: SortKey) {
		if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else {
			sortKey = key;
			sortDir = defaultDir[key];
		}
	}

	const sorted = $derived.by(() => {
		if (!sortKey) return filtered;
		const key = sortKey;
		const dir = sortDir === 'asc' ? 1 : -1;
		return [...filtered].sort((a, b) => {
			let cmp = 0;
			if (key === 'name') cmp = a.name.localeCompare(b.name);
			else if (key === 'role') cmp = a.roleLabel.localeCompare(b.roleLabel);
			else if (key === 'status') cmp = statusRank[a.status] - statusRank[b.status];
			else cmp = (a.lastActiveAt ?? -Infinity) - (b.lastActiveAt ?? -Infinity); // never-active sorts last
			return cmp * dir;
		});
	});

	// First two letters of the name, for the avatar chip (shared visual with <UsersTable>).
	const initials = (name: string) =>
		name
			.split(' ')
			.map((w) => w[0])
			.slice(0, 2)
			.join('')
			.toUpperCase();

	// Last Active hidden on tablet (sm–lg), visible at desktop (lg+).
	const columns = [
		{ label: 'Member' },
		{ label: 'Role' },
		{ label: 'Status' },
		{ label: 'Last active', class: 'hidden lg:table-cell' },
		{ label: 'Actions', srOnly: true }
	];

	const statusMeta: Record<StaffStatus, { tone: StatusTone; label: string }> = {
		active: { tone: 'online', label: 'Active' },
		pending: { tone: 'warning', label: 'Invitation sent' },
		disabled: { tone: 'blocked', label: 'Disabled' }
	};
</script>

<!-- Mobile: stacked card list (hidden at sm+) -->
<div class="flex flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-sm sm:hidden">
	<div class="border-b border-border">
		<div class="flex flex-col gap-2 px-4 py-3">
			<h2 class="text-sm font-semibold text-ink">Members</h2>
			<SearchInput
				bind:value={query}
				placeholder="Search name or email…"
				label="Search staff"
				class="w-full"
			/>
			<FilterTabs {tabs} active={filter} onselect={(key) => (filter = key)} fill />
		</div>
	</div>

	<div class="divide-y divide-border">
		{#each filtered as member (member.id)}
			<div
				class="flex items-start gap-3 px-4 py-3 transition-colors duration-150 hover:bg-surface"
				class:opacity-60={member.status === 'disabled'}
			>
				<span
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand"
					aria-hidden="true">{initials(member.name)}</span
				>
				<div class="min-w-0 flex-1">
					<div class="flex items-center justify-between gap-2">
						<p class="truncate font-medium text-ink">{member.name}</p>
						<StatusBadge
							tone={statusMeta[member.status].tone}
							label={statusMeta[member.status].label}
						/>
					</div>
					<p class="truncate font-mono text-xs text-muted">{member.email}</p>
					<div class="mt-1.5 flex items-center justify-between gap-2">
						<div class="flex items-center gap-2">
							{#if member.role === 'owner'}
								<span
									class="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand"
								>
									<Crown class="h-3 w-3" aria-hidden="true" />{member.roleLabel}
								</span>
							{:else}
								<span
									class="inline-flex items-center rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink"
									>{member.roleLabel}</span
								>
							{/if}
							<span class="font-mono text-xs text-muted">{member.lastActive}</span>
						</div>
						{#if member.role !== 'owner'}
							<div class="flex shrink-0 items-center gap-1">
								{#if confirmingId === member.id}
									<span class="text-xs text-muted">Remove?</span>
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
								{:else if promotingId === member.id}
									<span class="text-xs text-muted">Make owner?</span>
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
								{:else}
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
								{/if}
							</div>
						{/if}
					</div>
				</div>
			</div>
		{/each}

		{#if filtered.length === 0}
			<EmptyState
				icon={Search as unknown as Component}
				title="No staff members match"
				description="Try a different search term or status filter."
				compact
			/>
		{/if}
	</div>

	<div class="border-t border-border">
		<p class="px-4 py-3 text-xs text-muted">
			Showing {filtered.length} of {staff.length} staff members
		</p>
	</div>
</div>

<!-- Tablet+: full table (hidden below sm) -->
<div class="hidden sm:block">
	<Table {columns} scrollX>
		{#snippet toolbar()}
			<div class="flex flex-wrap items-center gap-3 px-4 py-3">
				<h2 class="text-base font-semibold text-ink">Members</h2>
				<FilterTabs {tabs} active={filter} onselect={(key) => (filter = key)} />
				<SearchInput
					bind:value={query}
					placeholder="Search name or email…"
					label="Search staff"
					class="ml-auto min-w-0 flex-1 sm:max-w-xs"
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
				<td class="hidden px-4 py-3 font-mono text-muted lg:table-cell">{member.lastActive}</td>
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

		{#snippet footer()}
			<p class="px-4 py-3 text-xs text-muted">
				Showing {filtered.length} of {staff.length} staff members
			</p>
		{/snippet}
	</Table>
</div>
