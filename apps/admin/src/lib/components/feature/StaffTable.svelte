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
	import UserCog from 'lucide-svelte/icons/user-cog';
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
	import PromoteDialog from './PromoteDialog.svelte';
	import OwnerChangeDialog from './OwnerChangeDialog.svelte';
	import TableSortControl from './TableSortControl.svelte';

	// Presentational table for the owner-only Staff page. Row actions post directly to
	// the page's form actions (?/setStatus, ?/remove, ?/promote); the route enforces
	// owner access. The owner row itself shows no actions (it can't be disabled,
	// removed, or re-promoted). Search + status filter run client-side over the
	// already-loaded `staff` (no extra loads), mirroring <UsersTable>/<TransactionsTable>.
	let {
		staff,
		onadd,
		form,
		currentUserId
	}: {
		staff: StaffMember[];
		onadd?: () => void;
		/** Page form result — passed to the dialogs for their action errors. */
		form?: { error?: string; action?: string } | null;
		/** The signed-in owner's id — distinguishes self-exit from targeting a peer. */
		currentUserId?: string;
	} = $props();

	// Inline two-step confirm for remove. Promotion (the highest-privilege grant) uses the
	// stronger <PromoteDialog> step-up (type-the-name + TOTP) instead of an inline confirm.
	let confirmingId = $state<string | null>(null); // remove
	let promoteOpen = $state(false);
	let promoteMember = $state<StaffMember | null>(null);

	// Owner demotion/removal (needs unanimous other-owner approval) via <OwnerChangeDialog>.
	let ownerChangeOpen = $state(false);
	let ownerChangeMember = $state<StaffMember | null>(null);
	let ownerChangeIsSelf = $state(false);

	// Only meaningful with ≥2 owners (a sole owner can't be demoted/removed — last-owner
	// guard), so the owner-row action is hidden otherwise.
	const ownerCount = $derived(staff.filter((m) => m.role === 'owner').length);

	function openOwnerChange(member: StaffMember) {
		ownerChangeMember = member;
		ownerChangeIsSelf = member.id === currentUserId;
		ownerChangeOpen = true;
	}

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
			let cmp: number;
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

	// Header config: `key` makes a column a clickable sort toggle; Actions stays static.
	const headers: { label: string; key?: SortKey; srOnly?: boolean }[] = [
		{ label: 'Member', key: 'name' },
		{ label: 'Role', key: 'role' },
		{ label: 'Status', key: 'status' },
		{ label: 'Last active', key: 'lastActive' },
		{ label: 'Actions', srOnly: true }
	];

	const statusMeta: Record<StaffStatus, { tone: StatusTone; label: string }> = {
		active: { tone: 'online', label: 'Active' },
		pending: { tone: 'warning', label: 'Invitation sent' },
		disabled: { tone: 'blocked', label: 'Disabled' }
	};
</script>

<!-- min-h-0 flex-1: the Staff page gives this a full-height flex column, so the table body
     scrolls internally (sticky header) instead of growing the page. -->
<Table cards class="min-h-0 flex-1">
	<!-- Toolbar: title + status filter + search, matching the Users/Transactions chrome. -->
	{#snippet toolbar()}
		<div class="flex flex-wrap items-center gap-3 px-4 py-3">
			<h2 class="text-base font-semibold text-ink">Members</h2>
			<SearchInput
				bind:value={query}
				placeholder="Search name or email…"
				label="Search staff"
				class="ml-auto min-w-0 flex-1 sm:max-w-xs"
			/>
			{#if onadd}
				<!-- Icon-only; "Add staff" shows as a native hover tooltip (title) + a11y label. -->
				<Button onclick={onadd} title="Add staff" aria-label="Add staff" class="shrink-0">
					<UserPlus class="h-4 w-4" aria-hidden="true" />
				</Button>
			{/if}
			<!-- Mobile sort: the sortable <thead> is hidden in card mode, so expose the same
			     keys here. md:hidden — desktop keeps the clickable headers. -->
			<TableSortControl
				id="staff-sort"
				label="Sort staff by"
				{headers}
				{sortKey}
				{sortDir}
				onToggle={(k) => toggleSort(k as SortKey)}
			/>
		</div>
	{/snippet}

	<!-- Clickable, sortable column headers (replaces Table's auto-generated header row). -->
	{#snippet headRow()}
		<tr class="border-b border-border bg-surface">
			{#each headers as h (h.label)}
				<th
					class="px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-muted uppercase"
					aria-sort={sortKey === h.key
						? sortDir === 'asc'
							? 'ascending'
							: 'descending'
						: undefined}
				>
					{#if h.srOnly}
						<span class="sr-only">{h.label}</span>
					{:else if h.key}
						<button
							type="button"
							onclick={() => toggleSort(h.key!)}
							class="group inline-flex items-center gap-1 tracking-wider uppercase transition-colors hover:text-ink {sortKey ===
							h.key
								? 'text-ink'
								: ''}"
						>
							{h.label}
							{#if sortKey === h.key}
								{#if sortDir === 'asc'}
									<ChevronUp class="h-3.5 w-3.5" aria-hidden="true" />
								{:else}
									<ChevronDown class="h-3.5 w-3.5" aria-hidden="true" />
								{/if}
							{:else}
								<ChevronsUpDown
									class="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-50"
									aria-hidden="true"
								/>
							{/if}
						</button>
					{:else}
						{h.label}
					{/if}
				</th>
			{/each}
		</tr>
	{/snippet}

	{#each sorted as member (member.id)}
		<tr class="hover:bg-surface" class:opacity-60={member.status === 'disabled'}>
			<td class="tc-full px-4 py-3">
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
			<td data-label="Role" class="px-4 py-3">
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
			<td data-label="Status" class="px-4 py-3">
				<StatusBadge
					tone={statusMeta[member.status].tone}
					label={statusMeta[member.status].label}
				/>
			</td>
			<td data-label="Last active" class="px-4 py-3 font-mono text-muted">{member.lastActive}</td>
			<td class="tc-full px-4 py-3">
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
					{:else}
						<div class="flex items-center justify-end gap-1">
							{#if member.role === 'admin' && member.status === 'active'}
								<IconButton
									icon={Crown as unknown as Component}
									label="Give {member.name} the owner role"
									onclick={() => {
										promoteMember = member;
										promoteOpen = true;
									}}
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
				{:else if ownerCount >= 2}
					<!-- Owner row: demote/remove needs unanimous other-owner approval. -->
					<div class="flex items-center justify-end gap-1">
						<IconButton
							icon={UserCog as unknown as Component}
							label={member.id === currentUserId
								? 'Step down as owner'
								: `Demote or remove ${member.name}`}
							tone="danger"
							onclick={() => openOwnerChange(member)}
						/>
					</div>
				{/if}
			</td>
		</tr>
	{/each}

	{#if filtered.length === 0}
		<tr>
			<td colspan={headers.length} class="tc-full p-0">
				<EmptyState
					icon={Search as unknown as Component}
					title="No staff members match"
					description="Try a different search term."
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

<!-- Step-up confirmation for promotion: type-the-name + TOTP, re-enforced server-side. -->
<PromoteDialog bind:open={promoteOpen} member={promoteMember} {form} />

<!-- Owner demotion/removal request (unanimous other-owner approval; TOTP step-up). -->
<OwnerChangeDialog
	bind:open={ownerChangeOpen}
	member={ownerChangeMember}
	isSelf={ownerChangeIsSelf}
	{form}
/>
