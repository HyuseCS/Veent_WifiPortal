<script lang="ts">
	import type { Snippet } from 'svelte';
	import { LiveDot } from '$lib/components/ui';
	import { live, connectLive } from '$lib/live.svelte';

	// `actions` renders page-specific controls on the right (e.g. the dashboard layout switcher).
	let { title, actions }: { title: string; actions?: Snippet } = $props();

	$effect(connectLive);

	const label = $derived(
		live.status === 'live' ? 'Live' : live.status === 'connecting' ? 'Connecting' : 'Offline'
	);
</script>

<header class="flex h-14 shrink-0 items-center justify-between border-b border-border bg-bg px-6">
	<div class="flex items-center gap-3">
		<h1 class="text-xl font-semibold text-ink">{title}</h1>
		<span class="flex items-center gap-1.5 text-xs text-muted">
			<LiveDot status={live.status} />
			{label}
		</span>
	</div>

	{#if actions}{@render actions()}{/if}
</header>
