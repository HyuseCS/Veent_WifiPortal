<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import ChevronLeft from 'lucide-svelte/icons/chevron-left';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';

	// KPI strip for pages with more metrics than fit across one row. Below xl the cards live in a
	// horizontal snap-scroll track: ~4 squares (2 rows × 2 cols) are visible with the next column
	// peeking to hint there's more. Swipe scrolls on
	// touch; the arrows nudge by one column. At xl+ it renders the original flat 5-across grid so
	// desktop is byte-identical. `card` is a snippet rendering one KpiCard from an item.
	let {
		items,
		card,
		class: klass = ''
	}: {
		items: T[];
		card: Snippet<[T]>;
		class?: string;
	} = $props();

	const GAP = 16; // matches gap-4

	let track = $state<HTMLDivElement>();
	let atStart = $state(true);
	let atEnd = $state(false);
	// Set by the first measure (runs after mount, before paint) — true only when the cards
	// actually overflow the track, so ≤perPage metrics never show dead arrows.
	let overflowing = $state(false);

	function update() {
		if (!track) return;
		overflowing = track.scrollWidth > track.clientWidth + 1;
		atStart = track.scrollLeft <= 1;
		atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
	}
	// Re-measure after mount and whenever the item count changes.
	$effect(() => {
		items.length;
		update();
	});

	// Nudge by one column (a card's width + the grid gap).
	function go(dir: -1 | 1) {
		if (!track) return;
		const col = (track.firstElementChild?.clientWidth ?? track.clientWidth) + GAP;
		track.scrollBy({ left: dir * col });
	}
</script>

<div class={klass}>
	<div class="relative xl:hidden">
		<!-- 2 rows, columns flow rightward; auto-cols-[46%] shows ~2 columns (4 cards) + a peek.
		     overscroll-contain so a horizontal swipe doesn't bounce the page; py-1 keeps card
		     shadows from being clipped by overflow. -->
		<div
			bind:this={track}
			onscroll={update}
			class="grid snap-x snap-proximity grid-flow-col auto-cols-[46%] grid-rows-[auto_auto] gap-4 overflow-x-auto overscroll-x-contain scroll-smooth py-1 [scrollbar-width:none] motion-reduce:scroll-auto [&::-webkit-scrollbar]:hidden"
		>
			{#each items as item, i (i)}
				<div class="snap-start">{@render card(item)}</div>
			{/each}
		</div>

		<!-- Arrows float vertically-centred on the side edges, over the cards. Each hides at its
		     end so it never sits there dead. -->
		{#if overflowing && !atStart}
			<button
				type="button"
				onclick={() => go(-1)}
				aria-label="Previous metrics"
				class="absolute top-1/2 left-1 z-10 flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-border bg-bg/90 text-ink shadow-md backdrop-blur transition-colors hover:bg-bg"
			>
				<ChevronLeft class="h-5 w-5" aria-hidden="true" />
			</button>
		{/if}
		{#if overflowing && !atEnd}
			<button
				type="button"
				onclick={() => go(1)}
				aria-label="More metrics"
				class="absolute top-1/2 right-1 z-10 flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-border bg-bg/90 text-ink shadow-md backdrop-blur transition-colors hover:bg-bg"
			>
				<ChevronRight class="h-5 w-5" aria-hidden="true" />
			</button>
		{/if}
	</div>

	<!-- xl+: flat grid, one equal column per metric so the strip always spans full width
	     regardless of count (5 metrics → byte-identical to the original grid-cols-5). -->
	<div class="hidden gap-4 xl:grid" style="grid-template-columns: repeat({items.length}, minmax(0, 1fr))">
		{#each items as item, i (i)}{@render card(item)}{/each}
	</div>
</div>
