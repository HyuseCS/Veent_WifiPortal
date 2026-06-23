<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	// Labeled text input. `name` defaults to `id`; any input attribute (type, autocomplete…) passes
	// through. `class` is appended to the base input classes for per-field tweaks (e.g. font-mono).
	let {
		id,
		label,
		name = id,
		class: klass = '',
		...rest
	}: { id: string; label: string; class?: string } & HTMLInputAttributes = $props();
</script>

<div class="space-y-1.5">
	<label for={id} class="block text-sm font-medium text-ink">{label}</label>
	<input
		{id}
		{name}
		{...rest}
		class="min-h-11 w-full rounded-lg border border-border bg-bg px-4 py-3 text-sm text-ink transition-[border-color,box-shadow] duration-150 hover:border-brand/40 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none {klass}"
	/>
</div>
