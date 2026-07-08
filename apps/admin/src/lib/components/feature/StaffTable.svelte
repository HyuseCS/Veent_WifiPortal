<script lang="ts">
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ChevronUp from 'lucide-svelte/icons/chevron-up';
	import ChevronsUpDown from 'lucide-svelte/icons/chevrons-up-down';
	import Search from 'lucide-svelte/icons/search';
	import UserPlus from 'lucide-svelte/icons/user-plus';
	import type { Component } from 'svelte';
	import type { StaffMember, StaffStatus, StatusTone } from '$lib/types';
	import { Avatar, Button, EmptyState, SearchInput, StatusBadge, Table } from '$lib/components/ui';
	import PromoteDialog from './PromoteDialog.svelte';
	import OwnerChangeDialog from './OwnerChangeDialog.svelte';
	import StaffMemberActions from './StaffMemberActions.svelte';
	import StaffProfileModal from './StaffProfileModal.svelte';
	import StaffRoleBadge from './StaffRoleBadge.svelte';
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

	// Promotion (the highest-privilege grant) uses the stronger <PromoteDialog> step-up
	// (type-the-name + TOTP) instead of an inline confirm. The inline remove two-step now
	// lives inside <StaffMemberActions> (shared by the row and the profile modal).
	let promoteOpen = $state(false);
	let promoteMember = $state<StaffMember | null>(null);

	// Owner demotion/removal (needs unanimous other-owner approval) via <OwnerChangeDialog>.
	let ownerChangeOpen = $state(false);
	let ownerChangeMember = $state<StaffMember | null>(null);
	let ownerChangeIsSelf = $state(false);

	// Profile detail modal. profileMemberId indexes into the LIVE `staff` list so any
	// mutation (via the shared actions) reflects immediately — the member is re-derived,
	// and the modal auto-closes if that member is removed.
	let profileMemberId = $state<string | null>(null);
	let profileOpen = $state(false);
	const profileMember = $derived(
		profileMemberId ? (staff.find((m) => m.id === profileMemberId) ?? null) : null
	);
	$effect(() => {
		if (profileOpen && profileMemberId && !profileMember) profileOpen = false;
	});

	// Only meaningful with ≥2 owners (a sole owner can't be demoted/removed — last-owner
	// guard), so the owner-row action is hidden otherwise.
	const ownerCount = $derived(staff.filter((m) => m.role === 'owner').length);

	function openOwnerChange(member: StaffMember) {
		ownerChangeMember = member;
		ownerChangeIsSelf = member.id === currentUserId;
		ownerChangeOpen = true;
	}

	function openProfile(member: StaffMember) {
		profileMemberId = member.id;
		profileOpen = true;
	}

	// Shared step-up launchers — used by BOTH the row actions and the profile modal.
	// Close the profile modal first so only one native <dialog> sits in the top layer.
	function handlePromote(member: StaffMember) {
		profileOpen = false;
		promoteMember = member;
		promoteOpen = true;
	}
	function handleOwnerChange(member: StaffMember) {
		profileOpen = false;
		openOwnerChange(member);
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
				<!-- Identity is the trigger for the profile modal. A single <button> (not the
				     whole row) keeps it free of nested interactive elements — the action buttons
				     stay independently focusable. -->
				<button
					type="button"
					onclick={() => openProfile(member)}
					title="View {member.name}'s profile"
					class="tc-trigger group -m-1 flex w-full items-center gap-3 rounded-md p-1 text-left outline-none transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-brand/40"
				>
					<Avatar src={member.image} name={member.name} class="h-9 w-9 text-xs" />
					<span class="min-w-0">
						<span class="block truncate font-medium text-ink group-hover:text-brand">{member.name}</span>
						<span class="block truncate font-mono text-xs text-muted">{member.email}</span>
					</span>
				</button>
			</td>
			<td data-label="Role" class="px-4 py-3">
				<StaffRoleBadge role={member.role} label={member.roleLabel} />
			</td>
			<td data-label="Status" class="px-4 py-3">
				<StatusBadge
					tone={statusMeta[member.status].tone}
					label={statusMeta[member.status].label}
				/>
			</td>
			<td data-label="Last active" class="px-4 py-3 font-mono text-muted">{member.lastActive}</td>
			<td class="tc-full tc-above px-4 py-3">
				<StaffMemberActions
					{member}
					{currentUserId}
					{ownerCount}
					layout="row"
					onPromote={handlePromote}
					onOwnerChange={handleOwnerChange}
				/>
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

<!-- Full profile detail (opened from a member's identity cell). Hosts the same actions as
     the row; promote / owner-change launch the step-up dialogs above. -->
<StaffProfileModal
	bind:open={profileOpen}
	member={profileMember}
	{currentUserId}
	{ownerCount}
	onPromote={handlePromote}
	onOwnerChange={handleOwnerChange}
/>
