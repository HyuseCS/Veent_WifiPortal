<script lang="ts">
	import MapIcon from 'lucide-svelte/icons/map';
	import EyeOff from 'lucide-svelte/icons/eye-off';
	import Filter from 'lucide-svelte/icons/filter';
	import { NetworkHealthCard, RouterLogPanel } from '$lib/components/feature';
	import type { NetworkAp } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const networks = $derived(data.networks);

	// "In use" = guests on it now, or any logged connection. Filters out idle
	// uplinks/VLANs (ether*, sfp*, vlan75…) so only networks carrying traffic show.
	const isInUse = (n: NetworkAp) => n.users > 0 || n.logs.length > 0;
	let activeOnly = $state(true);
	const visible = $derived(activeOnly ? networks.filter(isInUse) : networks);

	// One switch for every card's inline location map.
	let showMaps = $state(true);
</script>

<div class="flex flex-col gap-4 xl:flex-row">
	<!-- Left: the AP cards + controls. -->
	<div class="min-w-0 flex-1 space-y-4">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<p class="text-sm text-muted">Health per access point across the venue.</p>
			<div class="flex items-center gap-2">
				<button
					onclick={() => (activeOnly = !activeOnly)}
					class="flex min-h-[44px] items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-ink hover:bg-surface"
				>
					<Filter class="h-4 w-4" aria-hidden="true" />
					{activeOnly ? 'Show all networks' : 'Active only'}
				</button>
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
		</div>

		{#if visible.length === 0}
			<p
				class="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted"
			>
				No networks are carrying traffic yet.
				<button onclick={() => (activeOnly = false)} class="text-brand underline">Show all</button>
				to configure them.
			</p>
		{:else}
			<!-- auto-fill (not auto-fit): keeps empty tracks so a single visible card stays
			     its normal width instead of stretching across the whole row. -->
			<section
				class="grid items-start gap-4"
				style="grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));"
			>
				{#each visible as ap (ap.id)}
					<NetworkHealthCard {ap} showMap={showMaps} />
				{/each}
			</section>
		{/if}
	</div>

	<!-- Right: live router log. Sticky so it stays as the cards scroll. -->
	<div class="xl:w-80 xl:shrink-0">
		<div class="h-[70vh] xl:sticky xl:top-4 xl:h-[calc(100vh-6rem)]">
			<RouterLogPanel />
		</div>
	</div>
</div>
