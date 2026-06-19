<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';

	type Variant = 'primary' | 'secondary';

	// Text button with brand-action and neutral variants. `loading` disables it and shows a
	// spinner — drive it from a form's enhance pending state to block double-submits.
	let {
		variant = 'primary',
		loading = false,
		class: klass = '',
		children,
		...rest
	}: { variant?: Variant; loading?: boolean; class?: string; children: Snippet } & HTMLButtonAttributes =
		$props();

	const variants: Record<Variant, string> = {
		primary:
			'bg-brand font-semibold text-white hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
		secondary:
			'border border-border bg-bg font-medium text-ink hover:bg-surface hover:border-brand/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'
	};
</script>

<button
	{...rest}
	disabled={loading || rest.disabled}
	aria-busy={loading}
	class="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-sm transition-[background-color,border-color,transform,opacity] duration-150 outline-none active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 {variants[
		variant
	]} {klass}"
>
	{#if loading}
		<LoaderCircle class="h-4 w-4 animate-spin" aria-hidden="true" />
	{/if}
	{@render children()}
</button>
