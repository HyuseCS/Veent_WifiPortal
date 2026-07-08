<script lang="ts">
	import {
		SentryKpis,
		SentryTopIssues,
		SentryIssuesTable,
		SentryUnconfiguredState
	} from '$lib/components/feature/sentry';
	import type { PageData } from './$types';

	// Composition only — all data shaping happens server-side in the facade. When Sentry's API
	// isn't configured (no token/org/project) the load returns { configured: false } and we show
	// a designed empty state instead of a broken dashboard.
	let { data }: { data: PageData } = $props();
</script>

{#if !data.configured}
	<SentryUnconfiguredState
		description="Set SENTRY_AUTH_TOKEN, SENTRY_ORG_SLUG and SENTRY_PROJECT_ID to load issues here."
	/>
{:else}
	<div class="flex flex-col gap-6">
		<SentryKpis kpis={data.kpis} dashboardUrl={data.dashboardUrl} />
		<!-- Desktop: the full issues table (with per-row trend sparklines) sits inline. -->
		<div class="hidden md:block">
			<SentryIssuesTable
				issues={data.issues}
				degraded={data.degraded.issues}
				assignableStaff={data.assignableStaff}
			/>
		</div>
		<!-- Mobile: the table lives on its own page, so peek at the issues worth attention here. -->
		<div class="md:hidden">
			<SentryTopIssues issues={data.issues} />
		</div>
	</div>
{/if}
