<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	// Labeled text input. `name` defaults to `id`; any input attribute (type, autocomplete…) passes through.
	let {
		id,
		label,
		name = id,
		...rest
	}: { id: string; label: string } & HTMLInputAttributes = $props();
</script>

<div class="space-y-1.5">
	<label for={id} class="block text-sm font-medium text-ink">{label}</label>
	<input
		{id}
		{name}
		{...rest}
		class="min-h-[44px] w-full rounded-lg border border-border bg-bg px-4 py-3 text-sm text-ink transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
	/>
</div>
