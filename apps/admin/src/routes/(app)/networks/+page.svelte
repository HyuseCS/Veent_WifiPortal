<script lang="ts">
	import { NetworkHealthCard } from '$lib/components/feature';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const networks = $derived(data.networks);
</script>

<div class="space-y-4">
	<p class="text-sm text-muted">Health per access point across the venue.</p>
	<!-- items-start: a card whose "Map location" details is open grows on its own
	     instead of stretching every sibling in its grid row to match. -->
	<section
		class="grid items-start gap-4"
		style="grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));"
	>
		{#each networks as ap (ap.id)}
			<NetworkHealthCard {ap} />
		{/each}
	</section>
</div>
