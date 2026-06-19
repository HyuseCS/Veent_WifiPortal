<script lang="ts">
	import type { LiveStatus } from '$lib/live.svelte';

	let { status = 'live' }: { status?: LiveStatus } = $props();
	const color = $derived(
		status === 'live' ? 'bg-online' : status === 'connecting' ? 'bg-warning' : 'bg-blocked'
	);
	const label = $derived(
		status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Offline'
	);
</script>

<span class="relative flex h-2 w-2" aria-label={label}>
	{#if status === 'live'}
		<span class="absolute inline-flex h-full w-full animate-ping rounded-full {color} opacity-60"
		></span>
	{/if}
	<span class="relative inline-flex h-2 w-2 rounded-full {color}"></span>
</span>
