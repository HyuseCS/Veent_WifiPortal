<script lang="ts">
	import { NetworkMap } from '$lib/components/feature';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<!-- Negate main's padding so the map fills edge-to-edge. Topbar is h-16 (4rem). p-4 on mobile, p-6 on sm+. -->
<div class="-m-4 sm:-m-6 h-[calc(100vh-4rem)] overflow-hidden">
	<NetworkMap networks={data.networks} />
</div>
