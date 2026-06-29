<script lang="ts">
	import ScrollText from 'lucide-svelte/icons/scroll-text';
	import Router from 'lucide-svelte/icons/router';
	import { page } from '$app/state';

	// Networks page-wide nav, lifted into the Topbar header (mirrors FinanceHeaderControls).
	// On the overview the Router Log button is mobile-only — desktop shows the log inline; on
	// the full-screen log page the back-to-Networks button shows at all widths.
	const onLogs = $derived(page.url.pathname === '/networks/logs');
	const btn =
		'inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-bg px-4 text-sm font-medium text-ink transition-colors hover:bg-surface';
</script>

{#if onLogs}
	<a
		href="/networks"
		class="{btn} max-sm:w-11 max-sm:justify-center max-sm:px-0"
		aria-label="Networks"
	>
		<Router class="h-4 w-4" aria-hidden="true" />
		<span class="hidden sm:inline">Networks</span>
	</a>
{:else}
	<a
		href="/networks/logs"
		class="{btn} max-sm:w-11 max-sm:justify-center max-sm:px-0 md:hidden"
		aria-label="Router log"
	>
		<ScrollText class="h-4 w-4" aria-hidden="true" />
		<span class="hidden sm:inline">Router Log</span>
	</a>
{/if}
