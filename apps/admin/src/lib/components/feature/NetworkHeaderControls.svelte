<script lang="ts">
	import ScrollText from 'lucide-svelte/icons/scroll-text';
	import Router from 'lucide-svelte/icons/router';
	import Cpu from 'lucide-svelte/icons/cpu';
	import { page } from '$app/state';

	// Networks page-wide nav, lifted into the Topbar header (mirrors FinanceHeaderControls).
	// Three states: the overview (Router Models — owner-only — + a mobile-only Router Log button),
	// the log page, and the models page (both subpages show a back-to-Networks button at all widths).
	const onLogs = $derived(page.url.pathname === '/networks/logs');
	const onModels = $derived(page.url.pathname === '/networks/models');
	// Role rides in the (app) layout data on every networks route. Compare the string rather than
	// importing the server-side STAFF_ROLE enum into client code.
	const isOwner = $derived(page.data.user?.role === 'owner');
	const btn =
		'inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-bg px-4 text-sm font-medium text-ink transition-colors hover:bg-surface';
</script>

{#if onLogs || onModels}
	<a href="/networks" class="{btn} max-sm:w-11 max-sm:justify-center max-sm:px-0" aria-label="Networks">
		<Router class="h-4 w-4" aria-hidden="true" />
		<span class="hidden sm:inline">Networks</span>
	</a>
{:else}
	<div class="flex items-center gap-3">
		{#if isOwner}
			<a
				href="/networks/models"
				class="{btn} max-sm:w-11 max-sm:justify-center max-sm:px-0"
				aria-label="Router models"
			>
				<Cpu class="h-4 w-4" aria-hidden="true" />
				<span class="hidden sm:inline">Router Models</span>
			</a>
		{/if}
		<!-- Router Log is mobile-only — desktop shows the log inline on the overview. -->
		<a
			href="/networks/logs"
			class="{btn} max-sm:w-11 max-sm:justify-center max-sm:px-0 md:hidden"
			aria-label="Router log"
		>
			<ScrollText class="h-4 w-4" aria-hidden="true" />
			<span class="hidden sm:inline">Router Log</span>
		</a>
	</div>
{/if}
