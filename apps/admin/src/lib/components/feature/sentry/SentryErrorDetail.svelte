<script lang="ts">
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import type { SentryEventDetail, SentryIssue } from '$lib/server/sentry/types';

	// The exception → stacktrace → tags → counts detail for one Sentry issue. Self-fetches the
	// latest event from /sentry/event whenever `issue` changes (aborting stale requests). Shared by
	// the Sentry detail modal and the incident-form issue picker. `enabled` gates the fetch: the
	// modal keeps its children mounted while closed, so it passes `enabled={open}` to fetch only when
	// shown (and to re-fetch fresh detail on each reopen); the picker mounts it only when expanded,
	// so it defaults to true.
	let {
		issue,
		seenAgo,
		enabled = true
	}: {
		issue: SentryIssue;
		seenAgo: (iso: string) => string;
		enabled?: boolean;
	} = $props();

	let detail = $state<SentryEventDetail | null>(null);
	let loading = $state(false);
	let failed = $state(false);

	// Refetch whenever a new issue is opened (keyed on id); abort if it unmounts/disables mid-flight.
	$effect(() => {
		const id = enabled ? issue.id : null;
		if (!id) return;
		detail = null;
		failed = false;
		loading = true;
		const controller = new AbortController();
		fetch(`/sentry/event?id=${encodeURIComponent(id)}`, { signal: controller.signal })
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
			.then((d: SentryEventDetail) => (detail = d))
			.catch((e: unknown) => {
				if (!(e instanceof DOMException && e.name === 'AbortError')) failed = true;
			})
			.finally(() => (loading = false));
		return () => controller.abort();
	});

	// Most recent call first — the crash point sits at the top (Sentry ships frames oldest-first).
	const frames = $derived(detail ? [...detail.frames].reverse() : []);
</script>

{#if loading}
	<div class="flex items-center gap-2 py-6 text-sm text-muted">
		<LoaderCircle class="h-4 w-4 animate-spin" aria-hidden="true" />
		Loading latest event…
	</div>
{:else if failed}
	<div class="flex items-center gap-2 rounded-lg border border-border bg-surface p-4 text-sm text-muted">
		<TriangleAlert class="h-4 w-4 shrink-0" aria-hidden="true" />
		Couldn't load the event detail. The summary is still current.
	</div>
{:else if detail}
	<!-- Exception: the how (type) & why (value). -->
	<section>
		<h3 class="text-[11px] font-semibold tracking-wider text-muted uppercase">Exception</h3>
		<div class="mt-1 rounded-lg border border-border bg-surface p-3">
			{#if detail.type}<div class="font-mono text-sm font-medium text-ink">{detail.type}</div>{/if}
			{#if detail.value}<div class="mt-0.5 font-mono text-xs break-words text-muted">{detail.value}</div>{/if}
			{#if !detail.type && !detail.value}<div class="text-sm text-muted">No exception recorded on this event.</div>{/if}
		</div>
	</section>

	<!-- Stacktrace: which file, which line. -->
	{#if frames.length}
		<section>
			<h3 class="text-[11px] font-semibold tracking-wider text-muted uppercase">
				Stacktrace · most recent call first
			</h3>
			<ol class="mt-1 divide-y divide-border overflow-hidden rounded-lg border border-border">
				{#each frames as frame, i (i)}
					<li class="flex items-baseline gap-2 px-3 py-2 text-xs {frame.inApp ? 'bg-surface' : 'bg-bg opacity-70'}">
						<span class="min-w-0 flex-1 font-mono break-all text-ink">
							{frame.filename || '<unknown>'}{#if frame.lineNo != null}<span class="text-muted">:{frame.lineNo}</span>{/if}
						</span>
						{#if frame.function}<span class="shrink-0 font-mono text-muted">in {frame.function}</span>{/if}
						{#if frame.inApp}<span class="shrink-0 rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand">app</span>{/if}
					</li>
				{/each}
			</ol>
		</section>
	{:else if detail.culprit}
		<section>
			<h3 class="text-[11px] font-semibold tracking-wider text-muted uppercase">Location</h3>
			<div class="mt-1 font-mono text-xs break-words text-ink">{detail.culprit}</div>
		</section>
	{/if}

	<!-- Tags: environment, release, server, etc. -->
	{#if detail.tags.length}
		<section>
			<h3 class="text-[11px] font-semibold tracking-wider text-muted uppercase">Tags</h3>
			<div class="mt-1 flex flex-wrap gap-1.5">
				{#each detail.tags as tag (tag.key)}
					<span class="rounded border border-border bg-surface px-2 py-0.5 font-mono text-[11px] text-muted">
						{tag.key}: <span class="text-ink">{tag.value}</span>
					</span>
				{/each}
			</div>
		</section>
	{/if}
{/if}

<!-- Counts are from the already-loaded summary, so they show even if the event fetch fails. -->
<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
	<span>Events <span class="font-mono text-ink">{issue.count.toLocaleString('en-US')}</span></span>
	<span>Users <span class="font-mono text-ink">{issue.userCount.toLocaleString('en-US')}</span></span>
	<span>Last seen <span class="text-ink">{seenAgo(issue.lastSeen)}</span></span>
</div>
