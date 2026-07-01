<script lang="ts">
	import Check from 'lucide-svelte/icons/check';
	import BellOff from 'lucide-svelte/icons/bell-off';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import ShieldCheck from 'lucide-svelte/icons/shield-check';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import type { Component } from 'svelte';
	import { enhance } from '$app/forms';
	import { EmptyState, IconButton, StatusBadge, Table } from '$lib/components/ui';
	import type { StatusTone } from '$lib/types';
	import type { SentryIssue } from '$lib/server/sentry/types';

	// Issues list. Row actions post to the page's ?/resolve and ?/ignore form actions (the route
	// re-checks active-staff auth and rate-limits); this component is presentation only.
	let { issues, degraded = false }: { issues: SentryIssue[]; degraded?: boolean } = $props();

	const columns = [
		{ label: 'Issue' },
		{ label: 'Level' },
		{ label: 'Events' },
		{ label: 'Users' },
		{ label: 'Last seen' },
		{ label: 'Actions', srOnly: true }
	];

	// Map Sentry level → badge tone. Errors/fatals read as blocked, warnings as warning, the rest
	// (info/debug) as the calm online tone.
	const levelTone = (level: string): StatusTone =>
		level === 'error' || level === 'fatal' ? 'blocked' : level === 'warning' ? 'warning' : 'online';

	// Same "x ago" formatter the Users table uses (kept local — it isn't exported anywhere).
	function seenAgo(iso: string): string {
		if (!iso) return 'unknown';
		const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
		if (m < 1) return 'just now';
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
	}
</script>

<Table {columns} cards class="min-h-0 flex-1">
	{#snippet toolbar()}
		<div class="flex items-center gap-3 px-4 py-3">
			<h2 class="text-base font-semibold text-ink">Unresolved issues</h2>
			<span class="ml-auto text-xs text-muted">most frequent first</span>
		</div>
	{/snippet}

	{#each issues as issue (issue.id)}
		<tr class="hover:bg-surface">
			<td class="tc-full px-4 py-3">
				<div class="min-w-0">
					<div class="truncate font-medium text-ink">{issue.title}</div>
					{#if issue.culprit}
						<div class="truncate font-mono text-xs text-muted">{issue.culprit}</div>
					{/if}
				</div>
			</td>
			<td data-label="Level" class="px-4 py-3">
				<StatusBadge tone={levelTone(issue.level)} label={issue.level} />
			</td>
			<td data-label="Events" class="px-4 py-3 font-mono text-ink">
				{issue.count.toLocaleString('en-US')}
			</td>
			<td data-label="Users" class="px-4 py-3 font-mono text-muted">
				{issue.userCount.toLocaleString('en-US')}
			</td>
			<td data-label="Last seen" class="px-4 py-3 font-mono text-muted">{seenAgo(issue.lastSeen)}</td>
			<td class="tc-full px-4 py-3">
				<div class="flex items-center justify-end gap-1">
					<form method="post" action="?/resolve" use:enhance>
						<input type="hidden" name="id" value={issue.id} />
						<IconButton
							type="submit"
							icon={Check as unknown as Component}
							label="Resolve {issue.shortId || issue.title}"
						/>
					</form>
					<form method="post" action="?/ignore" use:enhance>
						<input type="hidden" name="id" value={issue.id} />
						<IconButton
							type="submit"
							icon={BellOff as unknown as Component}
							label="Ignore {issue.shortId || issue.title}"
						/>
					</form>
					{#if issue.permalink}
						<!-- permalink is an absolute external Sentry issue URL, so resolve() (for
						     app-internal relative paths) doesn't apply here. -->
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						<a
							href={issue.permalink}
							target="_blank"
							rel="noopener noreferrer"
							title="Open in Sentry"
							aria-label="Open {issue.shortId || issue.title} in Sentry"
							class="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
						>
							<ExternalLink class="h-4 w-4" aria-hidden="true" />
						</a>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					{/if}
				</div>
			</td>
		</tr>
	{/each}

	{#if issues.length === 0}
		<tr>
			<td colspan={columns.length} class="tc-full p-0">
				{#if degraded}
					<EmptyState
						icon={TriangleAlert as unknown as Component}
						title="Couldn't reach Sentry"
						description="The issues request failed. Try reloading in a moment."
						compact
					/>
				{:else}
					<EmptyState
						icon={ShieldCheck as unknown as Component}
						title="No unresolved issues"
						description="Nothing needs attention in the last 14 days."
						compact
					/>
				{/if}
			</td>
		</tr>
	{/if}
</Table>
