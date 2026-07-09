<script lang="ts">
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import Bell from 'lucide-svelte/icons/bell';
	import Check from 'lucide-svelte/icons/check';
	import type { Component } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { EmptyState } from '$lib/components/ui';
	import type { PageData } from './$types';

	// Full notification history (read + unread). Per-entry mark-read + mark-all live on the /issues
	// index actions; these forms post there and the resulting reload refreshes this list.
	let { data }: { data: PageData } = $props();
	const icon = (c: unknown) => c as Component;
	const hasUnread = $derived(data.history.some((n) => !n.read));

	// Compact relative time — no dep (Intl.RelativeTimeFormat), same idea as the bell/Timeline.
	const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
	function relTime(ms: number): string {
		const diff = ms - Date.now();
		const abs = Math.abs(diff);
		const min = 60_000,
			hr = 3_600_000,
			day = 86_400_000;
		if (abs < min) return 'just now';
		if (abs < hr) return rtf.format(Math.round(diff / min), 'minute');
		if (abs < day) return rtf.format(Math.round(diff / hr), 'hour');
		if (abs < day * 30) return rtf.format(Math.round(diff / day), 'day');
		return new Date(ms).toLocaleDateString();
	}
</script>

<div class="mx-auto flex h-full w-full max-w-3xl flex-col gap-4">
	<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
		<a
			href={resolve('/issues')}
			class="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-ink"
		>
			<ArrowLeft class="h-4 w-4" aria-hidden="true" />
			Back to incidents
		</a>
		{#if hasUnread}
			<form method="post" action="/issues?/markAllRead" class="ml-auto" use:enhance>
				<button
					type="submit"
					class="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg px-3 py-2 text-sm font-medium text-brand outline-none transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-brand/40"
				>
					<Check class="h-4 w-4" aria-hidden="true" />
					Mark all read
				</button>
			</form>
		{/if}
	</div>

	<div class="rounded-xl border border-border bg-bg">
		<div class="border-b border-border px-4 py-3">
			<h1 class="text-base font-semibold text-ink">Notifications</h1>
			<p class="text-xs text-muted">Activity on incidents assigned to you</p>
		</div>

		{#if data.history.length === 0}
			<EmptyState
				icon={icon(Bell)}
				title="No notifications yet"
				description="When there's activity on an incident assigned to you, it shows up here."
			/>
		{:else}
			<ul class="divide-y divide-border">
				{#each data.history as n (n.id)}
					<li class="flex items-start gap-3 px-4 py-3" class:opacity-60={n.read}>
						<!-- Unread dot / read placeholder keeps the text left-edge aligned. -->
						<span
							class="mt-1.5 h-2 w-2 shrink-0 rounded-full {n.read ? 'bg-transparent' : 'bg-brand'}"
							aria-hidden="true"
						></span>
						<a href={resolve(`/issues/${n.issueId}`)} class="min-w-0 flex-1">
							<span class="block truncate text-sm font-medium text-ink">{n.issueTitle}</span>
							<span class="block truncate text-xs text-muted">{n.summary}</span>
							<span class="text-[11px] text-muted">
								{relTime(n.createdAt)}
								{#if n.read && n.readAt}· read {relTime(n.readAt)}{/if}
							</span>
						</a>
						{#if n.read}
							<span class="shrink-0 text-[11px] font-medium text-muted">Read</span>
						{:else}
							<form method="post" action="/issues?/markOne" class="shrink-0" use:enhance>
								<input type="hidden" name="eventId" value={n.id} />
								<button
									type="submit"
									aria-label="Mark this notification as read"
									title="Mark as read"
									class="flex h-8 w-8 items-center justify-center rounded-md text-muted outline-none transition-colors hover:bg-surface hover:text-brand focus-visible:ring-2 focus-visible:ring-brand/40"
								>
									<Check class="h-4 w-4" aria-hidden="true" />
								</button>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
