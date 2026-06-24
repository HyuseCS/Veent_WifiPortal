<script lang="ts">
	import Ban from 'lucide-svelte/icons/ban';
	import ShieldCheck from 'lucide-svelte/icons/shield-check';
	import WifiOff from 'lucide-svelte/icons/wifi-off';
	import Wifi from 'lucide-svelte/icons/wifi';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import Search from 'lucide-svelte/icons/search';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import X from 'lucide-svelte/icons/x';
	import Smartphone from 'lucide-svelte/icons/smartphone';
	import MapPin from 'lucide-svelte/icons/map-pin';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ChevronUp from 'lucide-svelte/icons/chevron-up';
	import ChevronsUpDown from 'lucide-svelte/icons/chevrons-up-down';
	import type { Component, Snippet } from 'svelte';
	import { fade } from 'svelte/transition';
	import { SvelteSet } from 'svelte/reactivity';
	import { dev } from '$app/environment';
	import { enhance } from '$app/forms';
	import type { AdminUserRow, StatusTone } from '$lib/types';
	import { EmptyState, IconButton, SearchInput, StatusBadge, Table } from '$lib/components/ui';

	// `actions` lets the page slot owner-only controls (the Wipe button) into the toolbar
	// without this component owning the gated dialog/flow — data flow stays on the page.
	let { users, actions }: { users: AdminUserRow[]; actions?: Snippet } = $props();

	// Client-side view state over the already-loaded rows (no extra loads / no DB hits):
	// a text search + clickable-header sort. Status is reachable via the Status column
	// sorter, so the old status-filter pills + sort button were dropped (mirrors <StaffTable>).
	let query = $state('');

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return users;
		return users.filter((u) =>
			`${u.phone} ${u.lastMac ?? ''} ${u.devices.map((d) => d.mac ?? '').join(' ')}`
				.toLowerCase()
				.includes(q)
		);
	});

	// Clickable-header sorting. `null` key keeps the server order (by phone). Clicking a
	// header sorts by it; clicking the active header flips direction.
	type SortKey = 'phone' | 'balance' | 'timeLeft' | 'devices' | 'location' | 'status';
	let sortKey = $state<SortKey | null>(null);
	let sortDir = $state<'asc' | 'desc'>('asc');
	// Sensible first-click direction per column (e.g. soonest-to-expire / biggest balance first).
	const defaultDir: Record<SortKey, 'asc' | 'desc'> = {
		phone: 'asc',
		balance: 'desc',
		timeLeft: 'asc',
		devices: 'desc',
		location: 'asc',
		status: 'asc'
	};
	// Logical status order via tone (online → warning → blocked), not alphabetical.
	const toneRank: Record<StatusTone, number> = { online: 0, warning: 1, blocked: 2 };

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
			if (key === 'phone') cmp = a.phone.localeCompare(b.phone);
			else if (key === 'balance') cmp = a.balance - b.balance;
			else if (key === 'timeLeft') cmp = (a.timeLeftMs ?? -Infinity) - (b.timeLeftMs ?? -Infinity);
			else if (key === 'devices') cmp = a.deviceCount - b.deviceCount;
			else if (key === 'location') cmp = (a.location ?? '').localeCompare(b.location ?? '');
			else cmp = toneRank[a.tone] - toneRank[b.tone]; // status
			return cmp * dir;
		});
	});

	// Pretty-print an E.164 PH mobile (+63 then 10 digits) as "+63 917 654 4521"; raw otherwise.
	function fmtPhone(p: string): string {
		const m = p.match(/^\+63(\d{3})(\d{3})(\d{4})$/);
		return m ? `+63 ${m[1]} ${m[2]} ${m[3]}` : p;
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

	// Header config: `key` makes a column a clickable sort toggle; Actions stays static.
	const headers: { label: string; key?: SortKey; srOnly?: boolean }[] = [
		{ label: 'User', key: 'phone' },
		{ label: 'Balance', key: 'balance' },
		{ label: 'Time Left', key: 'timeLeft' },
		{ label: 'Devices', key: 'devices' },
		{ label: 'Location', key: 'location' },
		{ label: 'Status', key: 'status' },
		{ label: 'Actions', srOnly: true }
	];
</script>

<Table class="min-h-0 flex-1">
	<!-- Toolbar: search + any owner action (Wipe) on the right. -->
	{#snippet toolbar()}
		<div class="flex flex-wrap items-center gap-3 px-4 py-3">
			<SearchInput
				bind:value={query}
				placeholder="Search phone or MAC…"
				label="Search users"
				class="min-w-60 flex-1"
			/>
			<div class="ml-auto flex items-center gap-3">
				{@render actions?.()}
			</div>
		</div>
	{/snippet}

	<!-- Custom header row: master select-all checkbox + clickable, sortable column headers. -->
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
			{#each headers as h (h.label)}
				<th
					class="px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-muted uppercase {h.srOnly
						? 'text-right'
						: ''}"
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

	{#each sorted as user (user.id)}
		<tr class="hover:bg-surface" class:bg-surface={selected.has(user.id)}>
			<td class="px-4 py-3">
				<input
					type="checkbox"
					class="h-4 w-4 accent-brand"
					aria-label="Select {user.phone}"
					checked={selected.has(user.id)}
					onchange={(e) => toggle(user.id, e.currentTarget.checked)}
				/>
			</td>
			<td class="px-4 py-3">
				<span class="truncate font-mono font-medium text-ink">{fmtPhone(user.phone)}</span>
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
							: 's'} for {user.phone}"
						class="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-bg px-2.5 text-xs font-semibold text-ink transition-colors duration-150 hover:border-brand/40"
					>
						<Smartphone class="h-3.5 w-3.5 text-muted" aria-hidden="true" />
						<span class="font-mono">{user.deviceCount}</span>
						<ChevronDown
							class="h-3.5 w-3.5 text-muted transition-transform duration-150 {expanded.has(user.id)
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
				{#if user.location}
					<span class="inline-flex min-w-0 items-center gap-1.5 text-sm text-ink">
						<MapPin class="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
						<span class="truncate">{user.location}</span>
					</span>
				{:else}
					<span class="text-xs text-muted">—</span>
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
								label="Unblock {user.phone}"
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
									label="Allow WiFi for {user.phone} (dev)"
									disabled={!user.lastMac}
								/>
							</form>
						{/if}
						<form method="post" action="?/kick" use:enhance>
							<input type="hidden" name="userId" value={user.id} />
							<IconButton
								type="submit"
								icon={WifiOff as unknown as Component}
								label="Disconnect all of {user.phone}'s devices"
							/>
						</form>
						<form method="post" action="?/block" use:enhance>
							<input type="hidden" name="userId" value={user.id} />
							<IconButton
								type="submit"
								icon={Ban as unknown as Component}
								label="Block {user.phone} (disconnects all devices)"
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
				<td colspan={headers.length} class="px-4 pt-0 pb-3">
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
			<td colspan={headers.length + 1} class="p-0">
				<EmptyState
					icon={Search as unknown as Component}
					title="No users match your search"
					description="Try a different search term."
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
