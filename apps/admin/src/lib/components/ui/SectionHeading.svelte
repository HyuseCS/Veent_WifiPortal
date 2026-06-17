<script lang="ts">
	import type { Snippet } from 'svelte';

	// Section title with an optional right-aligned slot (e.g. a total, a filter).
	let {
		title,
		aside,
		class: klass = ''
	}: { title: string; aside?: Snippet; class?: string } = $props();
</script>

<div class="flex items-center justify-between gap-2 {klass}">
	<h2 class="text-base font-semibold text-ink">{title}</h2>
	{#if aside}{@render aside()}{/if}
</div>
