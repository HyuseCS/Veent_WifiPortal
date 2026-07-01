<script lang="ts">
	import Activity from 'lucide-svelte/icons/activity';
	import type { Component } from 'svelte';
	import { EmptyState } from '$lib/components/ui';
	import {
		SentryKpis,
		SentryVolumeChart,
		SentryIssuesTable
	} from '$lib/components/feature/sentry';
	import type { PageData } from './$types';

	// Composition only — all data shaping happens server-side in the facade. When Sentry's API
	// isn't configured (no token/org/project) the load returns { configured: false } and we show
	// a designed empty state instead of a broken dashboard.
	let { data }: { data: PageData } = $props();
</script>

{#if !data.configured}
	<EmptyState
		icon={Activity as unknown as Component}
		title="Sentry API not configured"
		description="Set SENTRY_AUTH_TOKEN, SENTRY_ORG_SLUG and SENTRY_PROJECT_ID to load issues and event volume here."
	/>
{:else}
	<!-- min-h-full so the chart (last visible item on mobile — the table is desktop-only) can
	     flex-1 down to the bottom of the page instead of leaving dead space. -->
	<div class="flex min-h-full flex-col gap-6">
		<SentryKpis kpis={data.kpis} dashboardUrl={data.dashboardUrl} />
		<SentryVolumeChart points={data.volume} degraded={data.degraded.volume} />
		<!-- Table is inline on desktop; on mobile it's its own page reached via the "Open issues" KPI. -->
		<div class="hidden md:block">
			<SentryIssuesTable issues={data.issues} degraded={data.degraded.issues} />
		</div>
	</div>
{/if}
