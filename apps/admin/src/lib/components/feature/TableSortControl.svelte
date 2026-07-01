<script lang="ts">
	import ListFilter from 'lucide-svelte/icons/list-filter';
	import ChevronUp from 'lucide-svelte/icons/chevron-up';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';

	/**
	 * Mobile sort control for the data tables (#8b). In card mode the sortable <thead> is
	 * hidden (md:hidden here mirrors that), so this exposes the same sort keys as an
	 * icon-only square <select> plus a direction toggle. It was copy-pasted near-verbatim
	 * into Users / Staff / Transactions tables — extracted here, with the sort API
	 * normalized to plain props so a store-backed (`sort.toggle`) or loose-variable
	 * (`toggleSort`) caller can both use it. Behavior + markup are unchanged.
	 */
	let {
		id,
		label,
		headers,
		sortKey,
		sortDir,
		onToggle
	}: {
		/** Unique id for the <select> + its sr-only label (e.g. "users-sort"). */
		id: string;
		/** sr-only label text, e.g. "Sort users by". */
		label: string;
		/** Column headers; only those with a `key` are offered as sort options. */
		headers: { key?: string; label: string }[];
		/** Currently-sorted column key, or null. */
		sortKey: string | null;
		sortDir: 'asc' | 'desc';
		/** Toggle/select a column (caller casts back to its own SortKey union). */
		onToggle: (key: string) => void;
	} = $props();
</script>

<div class="flex items-center gap-2 md:hidden">
	<label for={id} class="sr-only">{label}</label>
	<!-- Icon-only: a square select with a centred sort glyph; the chosen value is hidden
	     (text-transparent) — the native picker still lists the columns. -->
	<div class="relative shrink-0">
		<ListFilter
			class="pointer-events-none absolute top-1/2 left-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-muted"
			aria-hidden="true"
		/>
		<select
			{id}
			class="h-11 w-11 cursor-pointer appearance-none rounded-lg border border-border bg-bg text-transparent"
			value={sortKey ?? ''}
			onchange={(e) => onToggle(e.currentTarget.value)}
		>
			<option value="" disabled>Sort by…</option>
			{#each headers.filter((h) => h.key) as h (h.label)}
				<option value={h.key} class="text-ink">{h.label}</option>
			{/each}
		</select>
	</div>
	{#if sortKey}
		<button
			type="button"
			onclick={() => sortKey && onToggle(sortKey)}
			aria-label="Toggle sort direction ({sortDir === 'asc' ? 'ascending' : 'descending'})"
			class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-bg text-muted transition-colors hover:text-ink"
		>
			{#if sortDir === 'asc'}
				<ChevronUp class="h-4 w-4" aria-hidden="true" />
			{:else}
				<ChevronDown class="h-4 w-4" aria-hidden="true" />
			{/if}
		</button>
	{/if}
</div>
