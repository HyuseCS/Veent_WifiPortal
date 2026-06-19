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

<div
	class="flex flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-sm [&_tbody_tr]:transition-colors [&_tbody_tr]:duration-150 [&_tbody_tr:hover]:bg-surface {klass}"
>
	{#if title}
		<!-- Reuse SectionHeading so panel titles match the rest of the dashboard exactly. -->
		<div class="border-b border-border px-4 py-3">
			<SectionHeading {title} {aside} />
		</div>
	{/if}
	<div class="min-h-0 flex-1 overflow-auto">
		<table class="w-full text-sm">
			<thead class="sticky top-0 z-10">
				<tr class="border-b border-border bg-surface">
					{#each columns as col (col.label)}
						<th
							class="px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-muted uppercase"
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
