<script lang="ts">
	import { LiveDot } from '$lib/components/ui';
	import { live, connectLive } from '$lib/live.svelte';

	let { title }: { title: string } = $props();

	$effect(connectLive);

	const label = $derived(
		live.status === 'live' ? 'Live' : live.status === 'connecting' ? 'Connecting' : 'Offline'
	);
</script>

<header class="flex h-14 shrink-0 items-center justify-between border-b border-border bg-bg px-6">
	<h1 class="text-xl font-semibold text-ink">{title}</h1>

	<span class="flex items-center gap-2 text-xs text-muted">
		<LiveDot status={live.status} />
		{label}
	</span>
</header>
