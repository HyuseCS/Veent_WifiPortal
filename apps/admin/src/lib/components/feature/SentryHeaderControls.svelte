<script lang="ts">
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import { env } from '$env/dynamic/public';

	// "Open in Sentry" deep-link, lifted into the Topbar header (was the /sentry page heading).
	// PUBLIC_SENTRY_DASHBOARD_URL is a public URL (not a secret), so reading it client-side is
	// fine; when unset the button simply doesn't render.
	const dashboardUrl = env.PUBLIC_SENTRY_DASHBOARD_URL;
</script>

{#if dashboardUrl}
	<!-- Absolute external Sentry URL, so resolve() (for app-internal relative paths) doesn't apply. -->
	<!-- eslint-disable svelte/no-navigation-without-resolve -->
	<a
		href={dashboardUrl}
		target="_blank"
		rel="noopener noreferrer"
		aria-label="Open in Sentry"
		class="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-bg px-4 text-sm font-medium text-ink transition-colors duration-150 hover:border-brand/40 hover:bg-surface focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
	>
		<span class="hidden sm:inline">Open in Sentry</span>
		<ExternalLink class="h-4 w-4 text-muted" aria-hidden="true" />
	</a>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
{/if}
