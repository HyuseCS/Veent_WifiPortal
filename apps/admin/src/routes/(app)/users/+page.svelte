<script lang="ts">
	import Ban from 'lucide-svelte/icons/ban';
	import WifiOff from 'lucide-svelte/icons/wifi-off';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	// MOCK: replace with load() data when backend lands.
	import { users } from '$lib/mocks';
</script>

<div class="space-y-4">
	<p class="text-sm text-muted">{users.length} registered users.</p>

	<div class="overflow-hidden rounded-lg border border-border bg-bg">
		<table class="w-full text-sm">
			<thead>
				<tr class="border-b border-border bg-surface">
					<th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-muted uppercase">
						User
					</th>
					<th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-muted uppercase">
						Balance
					</th>
					<th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-muted uppercase">
						Usage
					</th>
					<th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-muted uppercase">
						Status
					</th>
					<th class="px-4 py-3"><span class="sr-only">Actions</span></th>
				</tr>
			</thead>
			<tbody class="divide-y divide-border">
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
								<!-- Stub actions — wired to backend later. -->
								<button
									type="button"
									aria-label="Kick {user.name} off the network"
									class="flex h-11 w-11 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-ink"
								>
									<WifiOff class="h-4 w-4" />
								</button>
								<button
									type="button"
									aria-label="Block {user.name}"
									class="flex h-11 w-11 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-blocked/10 hover:text-blocked"
								>
									<Ban class="h-4 w-4" />
								</button>
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
