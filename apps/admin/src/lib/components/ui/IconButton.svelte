<script lang="ts">
	import type { Component } from 'svelte';

	type Tone = 'default' | 'danger';

	// Square 44px icon-only button — accessible label is required (icon alone is not a label).
	// `type="submit"` lets it drive a surrounding <form>; defaults to a plain button.
	let {
		icon,
		label,
		tone = 'default',
		type = 'button',
		disabled = false,
		onclick
	}: {
		icon: Component;
		label: string;
		tone?: Tone;
		type?: 'button' | 'submit';
		disabled?: boolean;
		onclick?: () => void;
	} = $props();

	const tones: Record<Tone, string> = {
		default: 'text-muted hover:bg-surface hover:text-ink',
		danger: 'text-muted hover:bg-blocked/10 hover:text-blocked'
	};

	const Icon = $derived(icon);
</script>

<button
	{type}
	{disabled}
	aria-label={label}
	{onclick}
	class="flex h-11 w-11 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40 {disabled
		? 'text-muted'
		: `cursor-pointer ${tones[tone]}`}"
>
	<Icon class="h-4 w-4" />
</button>
