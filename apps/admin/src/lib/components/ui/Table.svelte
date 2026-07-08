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
	// `cards` opts a table into the responsive card-flip: below md the rows render as stacked
	// cards (see `.table-cards` in layout.css). Default off — desktop and non-opted tables
	// (e.g. the dashboard's) are byte-identical. Opted-in tables must give each <td> a
	// `data-label` (or `.tc-full`) for the mobile label/value rows.
	let {
		columns = [],
		children,
		title,
		aside,
		toolbar,
		headRow,
		footer,
		class: klass = '',
		cards = false,
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
		cards?: boolean;
		bodyHeight?: number;
	} = $props();
</script>

<!-- contain-layout isolates the table's block-size from the document: a nested scroll viewport
	 (min-h-0 flex-1 overflow-auto) inside this overflow-hidden shell otherwise leaks a tall table's
	 intrinsic height up to <html> (Chromium quirk), letting the WHOLE page scroll to white. Layout
	 containment doesn't affect the shell's own sizing (max-h / flex still apply), only stops the leak. -->
<div
	class="flex flex-col overflow-hidden contain-layout rounded-xl border border-border bg-bg shadow-sm {klass}"
>
	{#if toolbar}
		<div class="border-b border-border">{@render toolbar()}</div>
	{:else if title}
		<!-- Reuse SectionHeading so panel titles match the rest of the dashboard exactly. -->
		<div class="border-b border-border px-4 py-3">
			<SectionHeading {title} {aside} />
		</div>
	{/if}
	<div
		class="min-h-0 flex-1 overflow-auto {cards ? 'table-cards' : ''}"
		bind:clientHeight={bodyHeight}
	>
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

<style>
	/* Row hover highlight. Scoped here (not a Tailwind arbitrary variant) so it can use :has()
	   to SKIP full-width placeholder rows: an empty-state or "+N more" row is a single
	   <td colspan>, not an interactive data row, so hovering it shouldn't light up the whole
	   band. `tr` comes from the caller's snippet, hence :global; `tbody` is ours, so the rule
	   only reaches rows inside this shell. */
	tbody :global(tr:not(:has(td[colspan]))) {
		transition: background-color 150ms;
	}
	tbody :global(tr:not(:has(td[colspan]))):hover {
		background-color: var(--color-surface);
	}
</style>
