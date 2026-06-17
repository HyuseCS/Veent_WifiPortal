<script lang="ts">
	import type { NetworkAp } from '$lib/types';
	import { Card, StatusBadge } from '$lib/components/ui';

	let { ap }: { ap: NetworkAp } = $props();

	// Metric rows rendered from data so the markup stays a single <dl> loop.
	const metrics = $derived([
		{ label: 'Uptime', value: ap.uptime },
		{ label: 'Latency', value: ap.latency },
		{ label: 'Users', value: String(ap.users) },
		{ label: 'Tput', value: ap.throughput }
	]);
</script>

<Card padding="p-4">
	<div class="flex items-center justify-between gap-2">
		<h3 class="text-sm font-semibold text-ink">{ap.name}</h3>
		<StatusBadge tone={ap.tone} label={ap.status} />
	</div>
	<dl class="mt-4 grid grid-cols-4 divide-x divide-border text-center">
		{#each metrics as metric (metric.label)}
			<div class="px-2">
				<dt class="text-xs text-muted">{metric.label}</dt>
				<dd class="mt-0.5 font-mono text-sm font-semibold text-ink">{metric.value}</dd>
			</div>
		{/each}
	</dl>
</Card>
