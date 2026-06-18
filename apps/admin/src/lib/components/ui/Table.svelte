<script lang="ts">
	import type { Snippet } from 'svelte';
	import SectionHeading from './SectionHeading.svelte';

	/** A header cell definition. `srOnly` hides the label visually (e.g. an actions column). */
	interface Column {
		label: string;
		srOnly?: boolean;
	}

	// Bordered table shell: renders the styled header from `columns`; rows go in the default slot.
	// An optional `title` (with right-aligned `aside`) renders a header bar inside the shell so
	// the table's label is part of the component. `class` is appended to the shell (e.g.
	// `min-h-0 flex-1` to fill a fixed-height panel).
	let {
		columns,
		children,
		title,
		aside,
		class: klass = ''
	}: {
		columns: Column[];
		children: Snippet;
		title?: string;
		aside?: Snippet;
		class?: string;
	} = $props();
</script>

<div class="flex flex-col overflow-hidden rounded-lg border border-border bg-bg {klass}">
	{#if title}
		<!-- Reuse SectionHeading so panel titles match the rest of the dashboard exactly. -->
		<div class="bg-muted/10 px-4 pt-2 pb-0">
			<SectionHeading {title} {aside} />
		</div>
	{/if}
	<div class="min-h-0 flex-1 overflow-hidden">
		<table class="w-full text-sm">
			<thead>
				<tr class="border-b border-border bg-muted/10">
					{#each columns as col (col.label)}
						<th
							class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-muted uppercase"
						>
							{#if col.srOnly}<span class="sr-only">{col.label}</span>{:else}{col.label}{/if}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody class="divide-y divide-border">
				{@render children()}
			</tbody>
		</table>
	</div>
</div>
