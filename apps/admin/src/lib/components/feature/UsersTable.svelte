<script lang="ts">
	import Ban from 'lucide-svelte/icons/ban';
	import ShieldCheck from 'lucide-svelte/icons/shield-check';
	import WifiOff from 'lucide-svelte/icons/wifi-off';
	import Wifi from 'lucide-svelte/icons/wifi';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import type { Component } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { dev } from '$app/environment';
	import { enhance } from '$app/forms';
	import type { AdminUserRow } from '$lib/types';
	import { Button, IconButton, StatusBadge, Table } from '$lib/components/ui';

	let { users }: { users: AdminUserRow[] } = $props();

	// Set of selected user ids. SvelteSet so mutations stay reactive.
	const selected = new SvelteSet<string>();
	const allShown = $derived(users.length > 0 && users.every((u) => selected.has(u.id)));

	function toggle(id: string, on: boolean) {
		if (on) selected.add(id);
		else selected.delete(id);
	}
	function toggleAll(on: boolean) {
		if (on) for (const u of users) selected.add(u.id);
		else selected.clear();
	}

	const columns = [
		{ label: 'Select', srOnly: true },
		{ label: 'User' },
		{ label: 'Balance' },
		{ label: 'Usage' },
		{ label: 'Status' },
		{ label: 'Actions', srOnly: true }
	];
</script>

<!-- Bulk-selection toolbar: select-all + delete the current selection. Sits above the
     table so it's visible whether or not rows are selected (empty until you pick some). -->
<div class="flex min-h-[44px] items-center justify-between gap-3">
	<label class="flex cursor-pointer items-center gap-2 text-sm text-muted select-none">
		<input
			type="checkbox"
			class="h-4 w-4 accent-brand"
			checked={allShown}
			onchange={(e) => toggleAll(e.currentTarget.checked)}
		/>
		{selected.size > 0 ? `${selected.size} selected` : 'Select all'}
	</label>

	{#if selected.size > 0}
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
			<Button type="submit" variant="secondary" class="text-blocked hover:bg-blocked/10">
				<Trash2 class="h-4 w-4" aria-hidden="true" />
				Delete {selected.size} selected
			</Button>
		</form>
	{/if}
</div>

<Table {columns}>
	{#each users as user (user.id)}
		<tr class="transition-colors hover:bg-surface" class:bg-surface={selected.has(user.id)}>
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
				<div class="flex items-center gap-2">
					<span
						class="h-2 w-2 shrink-0 rounded-full {user.online ? 'bg-online' : 'bg-muted/40'}"
						title={user.online ? 'Online' : 'Offline'}
					></span>
					<div>
						<div class="font-medium text-ink">{user.name}</div>
						<div class="text-xs text-muted">{user.email}</div>
					</div>
				</div>
			</td>
			<td class="px-4 py-3 font-mono text-ink">₱{user.balance.toFixed(2)}</td>
			<td class="px-4 py-3 font-mono text-ink">{user.usage}</td>
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
								label="Kick {user.name} off the network"
							/>
						</form>
						<form method="post" action="?/block" use:enhance>
							<input type="hidden" name="userId" value={user.id} />
							<IconButton
								type="submit"
								icon={Ban as unknown as Component}
								label="Block {user.name}"
								tone="danger"
							/>
						</form>
					{/if}
				</div>
			</td>
		</tr>
	{/each}
</Table>
