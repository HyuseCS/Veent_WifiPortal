<script lang="ts">
	import { SentryIssuesTable, SentryUnconfiguredState } from '$lib/components/feature/sentry';
	import type { PageData } from './$types';

	// Dedicated issues screen — reached by tapping the "Open issues" KPI on mobile. Desktop keeps
	// the table inline on /sentry; this page still works there (direct link) as a full-width view.
	let { data }: { data: PageData } = $props();
</script>

{#if !data.configured}
	<!-- Route drops the main padding for the full-bleed table, so pad this fallback itself. -->
	<div class="p-4 sm:p-6">
		<SentryUnconfiguredState
			description="Set SENTRY_AUTH_TOKEN, SENTRY_ORG_SLUG and SENTRY_PROJECT_ID to load issues here."
		/>
	</div>
{:else}
	<!-- Full-height: the table (with its own toolbar/footer) is the whole page; "Back to overview"
	     lives in the Topbar (SentryHeaderControls). -->
	<div class="flex h-full flex-col">
		<SentryIssuesTable issues={data.issues} degraded={data.degraded.issues} fill />
	</div>
{/if}
