<script lang="ts">
	import Search from 'lucide-svelte/icons/search';

	// Shared search field — the icon-prefixed `<input type="search">` used by the Users,
	// Transactions, and Staff table toolbars. Centralizes the input chrome (border, focus
	// ring, hover, leading icon) so it's defined once instead of copy-pasted per table.
	// Callers own the value (bindable) and the wrapper sizing via `class`.
	let {
		value = $bindable(''),
		placeholder = 'Search…',
		label,
		class: klass = ''
	}: {
		value?: string;
		placeholder?: string;
		/** Accessible name for the input (rendered as `aria-label`). */
		label: string;
		/** Wrapper sizing/positioning (e.g. `min-w-60 flex-1`); the field fills it. */
		class?: string;
	} = $props();
</script>

<div class="relative {klass}">
	<Search
		class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted"
		aria-hidden="true"
	/>
	<input
		type="search"
		bind:value
		{placeholder}
		aria-label={label}
		class="min-h-11 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-sm text-ink transition-[border-color,box-shadow] duration-150 hover:border-brand/40 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
	/>
</div>
