<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	/**
	 * Designed empty state — a centered icon chip, title, and one explanatory line.
	 * Used in place of bare "No data" rows so an empty panel reads as intentional
	 * (and tells the operator *when* data will appear), not broken. Optional `action`
	 * snippet renders a CTA below the copy.
	 */
	let {
		icon,
		title,
		description,
		compact = false,
		action
	}: {
		icon: Component;
		title: string;
		description?: string;
		/** Tighter padding for inside short table panels. */
		compact?: boolean;
		action?: Snippet;
	} = $props();

	const Icon = $derived(icon);
</script>

<div
	class="animate-fade-in flex flex-col items-center justify-center text-center {compact
		? 'gap-2 p-6'
		: 'gap-3 p-10'}"
>
	<div
		class="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-muted"
		aria-hidden="true"
	>
		<Icon class="h-5 w-5" />
	</div>
	<div class="space-y-1">
		<p class="text-sm font-semibold text-ink">{title}</p>
		{#if description}
			<p class="mx-auto max-w-xs text-xs leading-relaxed text-muted">{description}</p>
		{/if}
	</div>
	{#if action}{@render action()}{/if}
</div>
