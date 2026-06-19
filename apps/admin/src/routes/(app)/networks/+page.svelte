<script lang="ts">
	import MapIcon from 'lucide-svelte/icons/map';
	import EyeOff from 'lucide-svelte/icons/eye-off';
	import { NetworkHealthCard } from '$lib/components/feature';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const networks = $derived(data.networks);

	// Router-reported interfaces a pin can bind to = the auto-discovered rows
	// (those without operator-set coordinates).
	const interfaces = $derived(networks.filter((n) => n.latitude == null).map((n) => n.name));

	// One switch for every card's inline location map.
	let showMaps = $state(true);
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between gap-3">
		<p class="text-sm text-muted">Health per access point across the venue.</p>
		<button
			onclick={() => (showMaps = !showMaps)}
			class="flex min-h-[44px] items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-ink hover:bg-surface"
		>
			{#if showMaps}
				<EyeOff class="h-4 w-4" aria-hidden="true" /> Hide all maps
			{:else}
				<MapIcon class="h-4 w-4" aria-hidden="true" /> Show all maps
			{/if}
		</button>
	</div>

	<!-- items-start: a card's location map grows on its own instead of stretching
	     every sibling in its grid row to match. -->
	<section
		class="grid items-start gap-4"
		style="grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));"
	>
		{#each networks as ap (ap.id)}
			<NetworkHealthCard {ap} showMap={showMaps} {interfaces} />
		{/each}
	</section>
</div>
