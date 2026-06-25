<script lang="ts">
	import type { Snippet } from 'svelte';

	// Bordered surface container — the base box for every panel/card on the dashboard.
	// Pass `onclick` to make the whole card an accessible button (used for drill-down
	// cards, e.g. the Networks "Alerts" KPI); without it the card is a plain div.
	let {
		padding = 'p-5',
		class: klass = '',
		onclick,
		children
	}: { padding?: string; class?: string; onclick?: () => void; children: Snippet } = $props();

	const base =
		'rounded-xl border border-border bg-bg shadow-sm transition-[box-shadow,transform,border-color] duration-200';
</script>

{#if onclick}
	<button type="button" {onclick} class="{base} {padding} {klass} w-full cursor-pointer text-left">
		{@render children()}
	</button>
{:else}
	<div class="{base} {padding} {klass}">
		{@render children()}
	</div>
{/if}
