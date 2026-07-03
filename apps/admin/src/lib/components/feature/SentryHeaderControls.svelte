<script lang="ts">
	import ChevronLeft from 'lucide-svelte/icons/chevron-left';
	import { resolve } from '$app/paths';

	// Back-to-overview nav for the /sentry/issues subpage, lifted into the Topbar (mirrors
	// NetworkHeaderControls). The issues table is the whole page below, so navigation lives up here.
	const btn =
		'inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-bg px-4 text-sm font-medium text-ink transition-colors hover:bg-surface';
</script>

<a
	href={resolve('/sentry')}
	class="{btn} max-sm:w-11 max-sm:justify-center max-sm:px-0"
	aria-label="Sentry overview"
>
	<ChevronLeft class="h-4 w-4" aria-hidden="true" />
	<span class="hidden sm:inline">Overview</span>
</a>
