<script lang="ts">
	import Plus from 'lucide-svelte/icons/plus';
	import ArrowRightLeft from 'lucide-svelte/icons/arrow-right-left';
	import UserPlus from 'lucide-svelte/icons/user-plus';
	import UserMinus from 'lucide-svelte/icons/user-minus';
	import Flag from 'lucide-svelte/icons/flag';
	import MessageSquare from 'lucide-svelte/icons/message-square';
	import PenLine from 'lucide-svelte/icons/pen-line';
	import History from 'lucide-svelte/icons/history';
	import type { Component } from 'svelte';
	import { EmptyState } from '$lib/components/ui';
	import type { IssueEventRow, IssueEventType } from '$lib/server/issues';

	/**
	 * Append-only audit timeline for one incident. Events arrive newest-first and fully
	 * server-formatted (summary/actor resolved in issues.ts) — this component only styles
	 * them: a per-type icon rail on the left, actor + time on the right. Read-only.
	 */
	let { events }: { events: IssueEventRow[] } = $props();

	const icon = (c: unknown) => c as Component;

	// Per-type icon + tone class. Tone is a subtle text color on the rail dot — colour is
	// never the only signal (the summary text carries the meaning), so this stays decorative.
	const META: Record<IssueEventType, { icon: Component; tone: string }> = {
		created: { icon: icon(Plus), tone: 'text-brand' },
		status_changed: { icon: icon(ArrowRightLeft), tone: 'text-warning' },
		assigned: { icon: icon(UserPlus), tone: 'text-online' },
		unassigned: { icon: icon(UserMinus), tone: 'text-muted' },
		priority_changed: { icon: icon(Flag), tone: 'text-blocked' },
		comment: { icon: icon(MessageSquare), tone: 'text-ink' },
		note_edited: { icon: icon(PenLine), tone: 'text-ink' }
	};
	const metaOf = (t: IssueEventType) => META[t] ?? { icon: icon(History), tone: 'text-muted' };

	// Absolute time on hover/title; short relative label inline (no dep — Intl.RelativeTimeFormat).
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
	const absTime = (ms: number) => new Date(ms).toLocaleString();
</script>

{#if events.length === 0}
	<EmptyState
		icon={icon(History)}
		title="No history yet"
		description="Changes to this incident will appear here."
		compact
	/>
{:else}
	<ol class="relative space-y-4">
		{#each events as e, i (e.id)}
			{@const m = metaOf(e.type)}
			<li class="relative flex gap-3">
				<!-- Icon rail: dot + connecting line down to the next entry (omitted on the last). -->
				<div class="relative flex flex-col items-center">
					<span
						class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface {m.tone}"
						aria-hidden="true"
					>
						<m.icon class="h-3.5 w-3.5" />
					</span>
					{#if i < events.length - 1}
						<span class="mt-1 w-px flex-1 bg-border"></span>
					{/if}
				</div>

				<div class="min-w-0 flex-1 pb-1">
					<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
						<span class="text-sm font-medium text-ink">{e.summary}</span>
						<time
							class="text-xs text-muted"
							datetime={new Date(e.createdAt).toISOString()}
							title={absTime(e.createdAt)}
						>
							{relTime(e.createdAt)}
						</time>
					</div>
					<p class="text-xs text-muted">by {e.actor}</p>
					{#if e.note}
						<p class="mt-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs whitespace-pre-wrap text-ink">
							{e.note}
						</p>
					{/if}
				</div>
			</li>
		{/each}
	</ol>
{/if}
