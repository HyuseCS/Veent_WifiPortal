<script lang="ts">
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import { SectionHeading } from '$lib/components/ui';

	// Page header: title + an "Open in Sentry" deep-link out (the public project URL). Rendered
	// as a plain <a> (not <Button>, which is a <button>) so it navigates to sentry.io in a new tab.
	let { dashboardUrl }: { dashboardUrl: string | null } = $props();
</script>

<SectionHeading title="Error monitoring">
	{#snippet aside()}
		{#if dashboardUrl}
			<!-- dashboardUrl is an absolute external Sentry URL (PUBLIC_SENTRY_DASHBOARD_URL), so
			     resolve() (for app-internal relative paths) doesn't apply. -->
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			<a
				href={dashboardUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-border bg-bg px-3 text-sm font-medium text-ink transition-colors duration-150 hover:border-brand/40 hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
			>
				Open in Sentry
				<ExternalLink class="h-3.5 w-3.5 text-muted" aria-hidden="true" />
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{/if}
	{/snippet}
</SectionHeading>
