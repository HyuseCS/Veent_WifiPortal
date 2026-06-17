<script lang="ts">
	import Ban from 'lucide-svelte/icons/ban';
	import ShieldCheck from 'lucide-svelte/icons/shield-check';
	import WifiOff from 'lucide-svelte/icons/wifi-off';
	import type { Component } from 'svelte';
	import { enhance } from '$app/forms';
	import type { AdminUserRow } from '$lib/types';
	import { IconButton, StatusBadge, Table } from '$lib/components/ui';

	let { users }: { users: AdminUserRow[] } = $props();

	const columns = [
		{ label: 'User' },
		{ label: 'Balance' },
		{ label: 'Usage' },
		{ label: 'Status' },
		{ label: 'Actions', srOnly: true }
	];
</script>

<Table {columns}>
	{#each users as user (user.id)}
		<tr class="transition-colors hover:bg-surface">
			<td class="px-4 py-3">
				<div class="font-medium text-ink">{user.name}</div>
				<div class="text-xs text-muted">{user.email}</div>
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
