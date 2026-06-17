<script lang="ts">
	import { NetworkHealthCard } from '$lib/components/feature';
	// MOCK: replace with load() data when backend lands.
	import { networks } from '$lib/mocks';
</script>

<div class="space-y-4">
	<p class="text-sm text-muted">Health per access point across the venue.</p>
	<section class="grid gap-4" style="grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));">
		{#each networks as ap (ap.id)}
			<NetworkHealthCard {ap} />
		{/each}
	</section>
</div>
