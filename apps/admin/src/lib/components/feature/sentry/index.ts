/**
 * Sentry-page feature components — each self-contained and prop-driven, composed by
 * routes/(app)/sentry/+page.svelte. Import as:
 *   `import { SentryHeader, SentryIssuesTable } from '$lib/components/feature/sentry';`
 */
export { default as SentryHeader } from './SentryHeader.svelte';
export { default as SentryKpis } from './SentryKpis.svelte';
export { default as SentryVolumeChart } from './SentryVolumeChart.svelte';
export { default as SentryIssuesTable } from './SentryIssuesTable.svelte';
