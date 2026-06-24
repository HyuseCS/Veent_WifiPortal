<script lang="ts">
	import Ban from 'lucide-svelte/icons/ban';
	import ShieldCheck from 'lucide-svelte/icons/shield-check';
	import WifiOff from 'lucide-svelte/icons/wifi-off';
	import Wifi from 'lucide-svelte/icons/wifi';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import Search from 'lucide-svelte/icons/search';
	import ArrowUpDown from 'lucide-svelte/icons/arrow-up-down';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import X from 'lucide-svelte/icons/x';
	import Smartphone from 'lucide-svelte/icons/smartphone';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import type { Component, Snippet } from 'svelte';
	import { fade } from 'svelte/transition';
	import { SvelteSet } from 'svelte/reactivity';
	import { dev } from '$app/environment';
	import { enhance } from '$app/forms';
	import type { AdminUserRow, StatusTone } from '$lib/types';
	import {
		EmptyState,
		FilterTabs,
		IconButton,
		SearchInput,
		StatusBadge,
		Table
	} from '$lib/components/ui';

	// `actions` lets the page slot owner-only controls (the Wipe button) into the toolbar
	// without this component owning the gated dialog/flow — data flow stays on the page.
	let { users, actions }: { users: AdminUserRow[]; actions?: Snippet } = $props();

	// Client-side view state over the already-loaded rows (no extra loads / no DB hits):
	// a text query, a status filter, and a sort key. All operate on `users` in memory.
	let query = $state('');
	let filter = $state<'all' | StatusTone>('all');
	let sortKey = $state<'name' | 'balance'>('name');

	// Status filter pills with live counts off the full set (so counts don't change as you filter).
	const statusCount = (tone: StatusTone) => users.filter((u) => u.tone === tone).length;
	const tabs = $derived([
		{ key: 'all' as const, label: 'All', count: users.length },
		{ key: 'online' as const, label: 'Active', count: statusCount('online') },
		{ key: 'warning' as const, label: 'Low', count: statusCount('warning') },
		{ key: 'blocked' as const, label: 'Blocked', count: statusCount('blocked') }
	]);

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		let rows = users.filter((u) => filter === 'all' || u.tone === filter);
		if (q) {
			rows = rows.filter((u) =>
				`${u.name} ${u.email} ${u.lastMac ?? ''} ${u.devices.map((d) => d.mac ?? '').join(' ')}`
					.toLowerCase()
					.includes(q)
			);
		}
		return [...rows].sort((a, b) =>
			sortKey === 'balance' ? b.balance - a.balance : a.name.localeCompare(b.name)
		);
	});
	const sortLabel = $derived(sortKey === 'balance' ? 'Balance' : 'Name');
	function cycleSort() {
		sortKey = sortKey === 'name' ? 'balance' : 'name';
	}

	// Set of selected user ids. SvelteSet so mutations stay reactive.
	const selected = new SvelteSet<string>();
	// Set of user ids whose device list is expanded into a detail row.
	const expanded = new SvelteSet<string>();
	function toggleExpand(id: string) {
		if (expanded.has(id)) expanded.delete(id);
		else expanded.add(id);
	}
	function seenAgo(iso: string | null): string {
		if (!iso) return 'unknown';
		const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
		if (m < 1) return 'just now';
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
	}
	// Select-all reflects the *visible* (filtered) rows so it tracks the current view.
	const allShown = $derived(filtered.length > 0 && filtered.every((u) => selected.has(u.id)));

	function toggle(id: string, on: boolean) {
		if (on) selected.add(id);
		else selected.delete(id);
	}
	function toggleAll(on: boolean) {
		if (on) for (const u of filtered) selected.add(u.id);
		else for (const u of filtered) selected.delete(u.id);
	}

	// First two letters of the name, for the avatar chip.
	const initials = (name: string) =>
		name
			.split(' ')
			.map((w) => w[0])
			.slice(0, 2)
			.join('')
			.toUpperCase();

	const columns = [
		{ label: 'User' },
		{ label: 'Balance' },
		{ label: 'Time Left' },
		{ label: 'Devices' },
		{ label: 'Status' },
		{ label: 'Actions', srOnly: true }
	];
</script>

<Table {columns} class="min-h-0 flex-1">
	<!-- Toolbar: search + status filter + sort, with any owner action (Wipe) on the right. -->
	{#snippet toolbar()}
		<div class="flex flex-wrap items-center gap-3 px-4 py-3">
			<SearchInput
				bind:value={query}
				placeholder="Search name, email or MAC…"
				label="Search users"
				class="min-w-60 flex-1"
			/>
			<FilterTabs {tabs} active={filter} onselect={(key) => (filter = key)} />
			<div class="ml-auto flex items-center gap-3">
				<button
					type="button"
					onclick={cycleSort}
					class="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border bg-bg px-3 text-xs font-bold text-muted transition-colors duration-150 hover:border-brand/40 hover:text-ink"
				>
					<ArrowUpDown class="h-4 w-4" aria-hidden="true" />
					{sortLabel}
				</button>
				{@render actions?.()}
			</div>
		</div>
	{/snippet}

	<!-- Custom header row: master select-all checkbox + column labels. -->
	{#snippet headRow()}
		<tr class="border-b border-border bg-surface">
			<th class="w-10 px-4 py-2.5">
				<input
					type="checkbox"
					class="h-4 w-4 accent-brand"
					aria-label="Select all users"
					checked={allShown}
					onchange={(e) => toggleAll(e.currentTarget.checked)}
				/>
			</th>
			{#each columns as col (col.label)}
				<th
					class="px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-muted uppercase {col.srOnly
						? 'text-right'
						: ''}"
				>
					{#if col.srOnly}<span class="sr-only">{col.label}</span>{:else}{col.label}{/if}
				</th>
			{/each}
		</tr>
	{/snippet}

	{#each filtered as user (user.id)}
		<tr class="hover:bg-surface" class:bg-surface={selected.has(user.id)}>
			<td class="px-4 py-3">
				<input
					type="checkbox"
					class="h-4 w-4 accent-brand"
					aria-label="Select {user.name}"
					checked={selected.has(user.id)}
					onchange={(e) => toggle(user.id, e.currentTarget.checked)}
				/>
			</td>
			<td class="px-4 py-3">
				<div class="flex items-center gap-3">
					<div class="relative shrink-0">
						<span
							class="flex h-9 w-9 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand"
							aria-hidden="true">{initials(user.name)}</span
						>
						<span
							class="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-bg {user.online
								? 'bg-online'
								: 'bg-muted/40'}"
							title={user.online ? 'Online' : 'Offline'}
						></span>
					</div>
					<div class="min-w-0">
						<div class="truncate font-medium text-ink">{user.name}</div>
						<div class="truncate text-xs text-muted">{user.email}</div>
					</div>
				</div>
			</td>
			<td class="px-4 py-3">
				<span
					class="inline-flex items-center gap-1.5 font-mono font-semibold {user.tone === 'warning'
						? 'text-warning'
						: 'text-ink'}"
				>
					₱{user.balance.toFixed(2)}
					{#if user.tone === 'warning'}
						<TriangleAlert class="h-3.5 w-3.5 text-warning" aria-label="Low balance" />
					{/if}
				</span>
			</td>
			<td class="px-4 py-3 font-mono text-ink">{user.timeLeft ?? '—'}</td>
			<td class="px-4 py-3">
				{#if user.deviceCount > 0}
					<button
						type="button"
						onclick={() => toggleExpand(user.id)}
						aria-expanded={expanded.has(user.id)}
						aria-label="{user.deviceCount} device{user.deviceCount === 1
							? ''
							: 's'} for {user.name}"
						class="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-bg px-2.5 text-xs font-semibold text-ink transition-colors duration-150 hover:border-brand/40"
					>
						<Smartphone class="h-3.5 w-3.5 text-muted" aria-hidden="true" />
						<span class="font-mono">{user.deviceCount}</span>
						<ChevronDown
							class="h-3.5 w-3.5 text-muted transition-transform duration-150 {expanded.has(
								user.id
							)
								? 'rotate-180'
								: ''}"
							aria-hidden="true"
						/>
					</button>
				{:else}
					<span class="font-mono text-xs text-muted">—</span>
				{/if}
			</td>
			<td class="px-4 py-3">
				<StatusBadge tone={user.tone} label={user.status} />
			</td>
			<td class="px-4 py-3">
				<div class="flex items-center justify-end gap-1">
					{#if user.tone === 'blocked'}
						<!-- Blocked users have no live session to kick; offer Unblock instead. -->
						<form method="post" action="?/unblock" use:enhance>
							<input type="hidden" name="userId" value={user.id} />
							<IconButton
								type="submit"
								icon={ShieldCheck as unknown as Component}
								label="Unblock {user.name}"
							/>
						</form>
					{:else}
						{#if dev}
							<!-- Dev-only: comp this user onto the WiFi (60-min session on their last
							     known device MAC). Disabled until we've seen a MAC for them. -->
							<form method="post" action="?/allowWifi" use:enhance>
								<input type="hidden" name="userId" value={user.id} />
								<input type="hidden" name="mac" value={user.lastMac ?? ''} />
								<IconButton
									type="submit"
									icon={Wifi as unknown as Component}
									label="Allow WiFi for {user.name} (dev)"
									disabled={!user.lastMac}
								/>
							</form>
						{/if}
						<form method="post" action="?/kick" use:enhance>
							<input type="hidden" name="userId" value={user.id} />
							<IconButton
								type="submit"
								icon={WifiOff as unknown as Component}
								label="Disconnect all of {user.name}'s devices"
							/>
						</form>
						<form method="post" action="?/block" use:enhance>
							<input type="hidden" name="userId" value={user.id} />
							<IconButton
								type="submit"
								icon={Ban as unknown as Component}
								label="Block {user.name} (disconnects all devices)"
								tone="danger"
							/>
						</form>
					{/if}
				</div>
			</td>
		</tr>
		{#if expanded.has(user.id) && user.deviceCount > 0}
			<tr class="bg-surface">
				<td></td>
				<td colspan={columns.length} class="px-4 pt-0 pb-3">
					<ul class="flex flex-col gap-1.5 rounded-lg border border-border bg-bg p-3">
						{#each user.devices as d, i (d.mac ?? i)}
							<li class="flex items-center gap-2 text-xs">
								<span class="h-1.5 w-1.5 rounded-full bg-online" aria-hidden="true"></span>
								<span class="font-mono text-ink">{d.mac ?? '—'}</span>
								<span class="text-muted">· seen {seenAgo(d.lastSeenAt)}</span>
							</li>
						{/each}
					</ul>
				</td>
			</tr>
		{/if}
	{/each}

	{#if filtered.length === 0}
		<tr>
			<td colspan={columns.length + 1} class="p-0">
				<EmptyState
					icon={Search as unknown as Component}
					title="No users match your filters"
					description="Try a different search term or status filter."
					compact
				/>
			</td>
		</tr>
	{/if}

	<!-- Footer: live count of what's shown vs. the full registered base. -->
	{#snippet footer()}
		<p class="px-4 py-3 text-xs text-muted">
			Showing {filtered.length} of {users.length} users
		</p>
	{/snippet}
</Table>

<!-- Floating bulk bar: appears only with a selection. Delete is the one bulk action with a
     backing form action; select/clear are local UI state. -->
{#if selected.size > 0}
	<div
		transition:fade={{ duration: 150 }}
		class="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-2xl bg-sidebar py-2 pr-2 pl-4 shadow-lg"
	>
		<span class="text-sm font-semibold text-sidebar-text">{selected.size} selected</span>
		<span class="mx-1 h-5 w-px bg-sidebar-muted/30" aria-hidden="true"></span>
		<form
			method="post"
			action="?/delete"
			use:enhance={() =>
				({ update, result }) => {
					if (result.type === 'success') selected.clear();
					return update();
				}}
		>
			<input type="hidden" name="userIds" value={[...selected].join(',')} />
			<button
				type="submit"
				class="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg bg-blocked px-3 text-sm font-semibold text-white transition-[filter] duration-150 hover:brightness-110"
			>
				<Trash2 class="h-4 w-4" aria-hidden="true" />
				Delete
			</button>
		</form>
		<button
			type="button"
			onclick={() => selected.clear()}
			aria-label="Clear selection"
			class="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-sidebar-muted transition-colors duration-150 hover:text-sidebar-text"
		>
			<X class="h-4 w-4" aria-hidden="true" />
		</button>
	</div>
{/if}
