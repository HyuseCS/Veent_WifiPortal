<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	type Variant = 'primary' | 'secondary';

	// Text button with brand-action and neutral variants. Extra attributes (type, formaction…) pass through.
	let {
		variant = 'primary',
		class: klass = '',
		children,
		...rest
	}: { variant?: Variant; class?: string; children: Snippet } & HTMLButtonAttributes = $props();

	const variants: Record<Variant, string> = {
		primary:
			'bg-brand font-semibold text-white hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
		secondary: 'border border-border bg-bg font-medium text-ink hover:bg-surface'
	};
</script>

<button
	{...rest}
	class="min-h-[44px] cursor-pointer rounded-lg px-4 text-sm transition-colors {variants[
		variant
	]} {klass}"
>
	{@render children()}
</button>
