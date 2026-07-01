<script lang="ts">
	import { RouterModelsPanel } from '$lib/components/feature';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<!-- Owner-only router model catalog editor. Back-to-Networks lives in the Topbar header
     (NetworkHeaderControls). Constrained width on desktop; the panel is full-width on mobile
     and scrolls within the main scroll area. -->
<div class="mx-auto w-full max-w-3xl pt-1">
	<RouterModelsPanel models={data.models} {form} />
</div>
