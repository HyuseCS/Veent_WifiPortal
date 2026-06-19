<script lang="ts">
	import type { Snippet } from 'svelte';
	import { LiveStatusPill } from '$lib/components/ui';
	import { live, connectLive } from '$lib/live.svelte';

	// `actions` renders page-specific controls on the right (e.g. the dashboard layout switcher).
	let { title, subtitle, actions }: { title: string; subtitle?: string; actions?: Snippet } =
		$props();

	$effect(connectLive);
</script>

<header
	class="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-bg px-4 sm:px-6"
>
	<div class="flex min-w-0 items-center gap-3">
		<div class="min-w-0">
			<h1 class="truncate text-lg font-semibold tracking-tight text-ink sm:text-xl">{title}</h1>
			{#if subtitle}
				<p class="truncate text-xs text-muted">{subtitle}</p>
			{/if}
		</div>
		<LiveStatusPill status={live.status} />
	</div>

	{#if actions}
		<div class="flex shrink-0 items-center gap-2">{@render actions()}</div>
	{/if}
</header>
