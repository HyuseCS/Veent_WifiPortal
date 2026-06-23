<script lang="ts">
	import type { HTMLSelectAttributes } from 'svelte/elements';

	interface Option {
		value: string;
		label: string;
	}

	// Labeled select, styled to match Field. `name` defaults to `id`; `value` is bindable
	// and defaults to the first option so uncontrolled (FormData) usage has a valid selection.
	let {
		id,
		label,
		options,
		value = $bindable(options[0]?.value ?? ''),
		name = id,
		...rest
	}: { id: string; label: string; options: Option[] } & HTMLSelectAttributes = $props();
</script>

<div class="space-y-1.5">
	<label for={id} class="block text-sm font-medium text-ink">{label}</label>
	<select
		{id}
		{name}
		bind:value
		{...rest}
		class="min-h-[44px] w-full cursor-pointer rounded-lg border border-border bg-bg px-4 py-3 text-sm text-ink transition-[border-color,box-shadow] duration-150 hover:border-brand/40 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
	>
		{#each options as option (option.value)}
			<option value={option.value}>{option.label}</option>
		{/each}
	</select>
</div>
