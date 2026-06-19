<script lang="ts">
	import { NetworkMap } from '$lib/components/feature';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<!-- Negate main's p-6 padding so the map fills edge-to-edge. Topbar is h-14 (3.5rem). -->
<div class="-m-6 h-[calc(100vh-3.5rem)] overflow-hidden">
	<NetworkMap networks={data.networks} />
</div>
