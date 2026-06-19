<script lang="ts">
	import type { Snippet } from 'svelte';

	// Bordered surface container — the base box for every panel/card on the dashboard.
	let {
		padding = 'p-5',
		class: klass = '',
		children
	}: { padding?: string; class?: string; children: Snippet } = $props();
</script>

<div
	class="rounded-xl border border-border bg-bg shadow-sm transition-[box-shadow,transform,border-color] duration-200 {padding} {klass}"
>
	{@render children()}
</div>
