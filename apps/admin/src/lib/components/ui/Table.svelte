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
	//
	// For richer layouts, three optional snippets compose inside the same card shell:
	//   `toolbar` — a free-form controls bar above the table (search / filters / actions),
	//               rendered instead of the `title` bar when supplied.
	//   `headRow` — replaces the auto-generated `<tr>` of header cells, for interactive
	//               headers (e.g. a select-all checkbox). `columns` is then optional.
	//   `footer`  — a bar below the table (e.g. "Showing X of Y").
	// All three are backward-compatible: existing `title`/`aside`/`columns` callers are unchanged.
	// `bodyHeight` reports the live pixel height of the scroll viewport (the area between the
	// header and footer bars). Optional and bindable — consumers that need to fit a fixed
	// number of rows to the available space (e.g. the dashboard's "+N more" tables) bind it
	// and derive a row cap from it; everyone else ignores it at zero cost.
	let {
		columns = [],
		children,
		title,
		aside,
		toolbar,
		headRow,
		footer,
		class: klass = '',
		bodyHeight = $bindable(0)
	}: {
		columns?: Column[];
		children: Snippet;
		title?: string;
		aside?: Snippet;
		toolbar?: Snippet;
		headRow?: Snippet;
		footer?: Snippet;
		class?: string;
		bodyHeight?: number;
	} = $props();
</script>

<div
	class="flex flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-sm [&_tbody_tr]:transition-colors [&_tbody_tr]:duration-150 [&_tbody_tr:hover]:bg-surface {klass}"
>
	{#if toolbar}
		<div class="border-b border-border">{@render toolbar()}</div>
	{:else if title}
		<!-- Reuse SectionHeading so panel titles match the rest of the dashboard exactly. -->
		<div class="border-b border-border px-4 py-3">
			<SectionHeading {title} {aside} />
		</div>
	{/if}
	<div class="min-h-0 flex-1 overflow-auto" bind:clientHeight={bodyHeight}>
		<table class="w-full text-sm">
			<thead class="sticky top-0 z-10">
				{#if headRow}
					{@render headRow()}
				{:else}
					<tr class="border-b border-border bg-surface">
						{#each columns as col (col.label)}
							<th
								class="px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-muted uppercase"
							>
								{#if col.srOnly}<span class="sr-only">{col.label}</span>{:else}{col.label}{/if}
							</th>
						{/each}
					</tr>
				{/if}
			</thead>
			<tbody class="divide-y divide-border">
				{@render children()}
			</tbody>
		</table>
	</div>
	{#if footer}
		<div class="border-t border-border">{@render footer()}</div>
	{/if}
</div>
