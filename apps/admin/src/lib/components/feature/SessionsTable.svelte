<script lang="ts">
	import type { ActiveSession } from '$lib/types';
	import { StatusBadge, Table } from '$lib/components/ui';

	let { sessions }: { sessions: ActiveSession[] } = $props();

	const columns = [
		{ label: 'MAC Address' },
		{ label: 'Package' },
		{ label: 'Time Left' },
		{ label: 'Status' }
	];
</script>

<Table {columns}>
	{#each sessions as session (session.mac)}
		<tr class="transition-colors hover:bg-surface">
			<td class="px-4 py-3 font-mono text-xs text-ink">{session.mac}</td>
			<td class="px-4 py-3 text-ink">{session.package}</td>
			<td class="px-4 py-3 font-mono text-ink">{session.timeLeft}</td>
			<td class="px-4 py-3">
				<StatusBadge tone={session.tone} label={session.status} />
			</td>
		</tr>
	{/each}
</Table>
