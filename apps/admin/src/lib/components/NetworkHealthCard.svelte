<script lang="ts">
	import type { NetworkAp } from '$lib/types';
	import StatusBadge from './StatusBadge.svelte';

	let { ap }: { ap: NetworkAp } = $props();
</script>

<div class="rounded-lg border border-border bg-bg p-4">
	<div class="flex items-center justify-between gap-2">
		<h3 class="text-sm font-semibold text-ink">{ap.name}</h3>
		<StatusBadge tone={ap.tone} label={ap.status} />
	</div>
	<dl class="mt-4 grid grid-cols-4 divide-x divide-border text-center">
		<div class="px-2">
			<dt class="text-xs text-muted">Uptime</dt>
			<dd class="mt-0.5 font-mono text-sm font-semibold text-ink">{ap.uptime}</dd>
		</div>
		<div class="px-2">
			<dt class="text-xs text-muted">Latency</dt>
			<dd class="mt-0.5 font-mono text-sm font-semibold text-ink">{ap.latency}</dd>
		</div>
		<div class="px-2">
			<dt class="text-xs text-muted">Users</dt>
			<dd class="mt-0.5 font-mono text-sm font-semibold text-ink">{ap.users}</dd>
		</div>
		<div class="px-2">
			<dt class="text-xs text-muted">Tput</dt>
			<dd class="mt-0.5 font-mono text-sm font-semibold text-ink">{ap.throughput}</dd>
		</div>
	</dl>
</div>
