<script lang="ts">
	// Neutral page skeleton shown while a cross-route navigation resolves. SvelteKit blocks on
	// the target route's `load`, so without this the previous page just freezes with no feedback.
	// Deliberately generic — a heading strip, a KPI-style card row, and a content panel — so it
	// reads as "loading" on any admin route without pretending to mirror a specific one.
	//
	// Two nested animations, split so they don't clash on the `animation` shorthand:
	//   • outer `.route-skeleton` (layout.css) = a DELAYED fade-in, so fast navigations unmount
	//     this before it's ever visible and only genuinely slow loads flash a placeholder.
	//   • inner `animate-pulse` = the usual shimmer, matching the in-page skeletons (e.g. finance).
	// `h-full` on both keeps it height-passthrough for the full-height routes. aria-hidden: it's
	// decorative — `<main>` carries aria-busy while loading.
</script>

<div class="route-skeleton h-full" aria-hidden="true">
	<div class="flex h-full animate-pulse flex-col gap-6">
		<!-- heading strip (title + subtitle) -->
		<div class="flex flex-col gap-2">
			<div class="h-5 w-40 rounded bg-surface"></div>
			<div class="h-3 w-56 rounded bg-surface"></div>
		</div>

		<!-- KPI-style card row -->
		<div class="grid shrink-0 grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
			{#each Array.from({ length: 4 }, (_, i) => i) as i (i)}
				<div class="flex flex-col gap-3 rounded-xl border border-border bg-bg p-4 shadow-sm">
					<div class="h-3 w-20 rounded bg-surface"></div>
					<div class="h-6 w-16 rounded bg-surface"></div>
					<div class="h-3 w-24 rounded bg-surface"></div>
				</div>
			{/each}
		</div>

		<!-- large content panel (chart / table stand-in) -->
		<div class="min-h-0 flex-1 rounded-xl border border-border bg-bg p-5 shadow-sm">
			<div class="mb-5 h-4 w-32 rounded bg-surface"></div>
			<div class="flex flex-col gap-3">
				{#each Array.from({ length: 6 }, (_, i) => i) as i (i)}
					<div class="h-9 w-full rounded bg-surface"></div>
				{/each}
			</div>
		</div>
	</div>
</div>
