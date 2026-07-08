<script lang="ts">
	import { resolve } from '$app/paths';
	import { Card, SectionHeading, Sparkline, StatusBadge } from '$lib/components/ui';
	import { trendDirection } from '$lib/trend';
	import type { SentryIssue } from '$lib/server/sentry/types';
	import type { StatusTone } from '$lib/types';

	// Mobile-only "peek" that replaces the old error-volume chart on the /sentry overview. The full
	// issues table lives on its own page on mobile, so this surfaces the few issues worth a glance
	// (with their 14d trend) and taps through. Desktop shows the full inline table instead.
	let { issues, count = 4 }: { issues: SentryIssue[]; count?: number } = $props();

	const levelTone = (level: string): StatusTone =>
		level === 'error' || level === 'fatal' ? 'blocked' : level === 'warning' ? 'warning' : 'online';

	// Climbers first (rising 14d trend), then most events — surfaces "getting worse" at a glance,
	// but falls back to plain most-frequent when nothing's rising, so the peek is never empty.
	const top = $derived.by(() => {
		const rising = (i: SentryIssue) => (trendDirection(i.trend14d) === 'up' ? 1 : 0);
		return [...issues].sort((a, b) => rising(b) - rising(a) || b.count - a.count).slice(0, count);
	});
	const issuesHref = resolve('/sentry/issues');
</script>

<Card>
	<SectionHeading title="Top issues" class="mb-2">
		{#snippet aside()}
			<a href={issuesHref} class="text-xs font-semibold text-brand hover:underline">View all →</a>
		{/snippet}
	</SectionHeading>

	{#if top.length}
		<ul class="flex flex-col divide-y divide-border">
			{#each top as issue (issue.id)}
				<li>
					<a
						href={issuesHref}
						class="flex min-h-11 items-center gap-3 py-2 transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
					>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<StatusBadge tone={levelTone(issue.level)} label={issue.level} />
								<span class="truncate text-sm font-medium text-ink">{issue.title}</span>
							</div>
							{#if issue.culprit}
								<div class="truncate font-mono text-xs text-muted">{issue.culprit}</div>
							{/if}
						</div>
						<Sparkline values={issue.trend14d} label={issue.shortId || issue.title} />
						<span class="w-12 shrink-0 text-right font-mono text-sm text-ink">
							{issue.count.toLocaleString('en-US')}
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="py-6 text-center text-sm text-muted">No unresolved issues in the last 14 days.</p>
	{/if}
</Card>
