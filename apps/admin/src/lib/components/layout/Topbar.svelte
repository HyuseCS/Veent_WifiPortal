<script lang="ts">
	import { Button, LiveDot } from '$lib/components/ui';

	let { title, userName }: { title: string; userName?: string } = $props();
</script>

<header class="flex h-14 shrink-0 items-center justify-between border-b border-border bg-bg px-6">
	<h1 class="text-xl font-semibold text-ink">{title}</h1>

	<div class="flex items-center gap-4">
		<span class="flex items-center gap-2 text-xs text-muted">
			<LiveDot />
			Live
		</span>
		{#if userName}
			<span class="text-sm text-muted">{userName}</span>
		{/if}
		<form method="POST" action="/logout">
			<Button variant="secondary">Sign out</Button>
		</form>
	</div>
</header>
