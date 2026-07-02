<script lang="ts">
	import BellOff from 'lucide-svelte/icons/bell-off';
	import Check from 'lucide-svelte/icons/check';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import X from 'lucide-svelte/icons/x';
	import { enhance } from '$app/forms';
	import { BaseDialog, IconButton, StatusBadge } from '$lib/components/ui';
	import type { StatusTone } from '$lib/types';
	import type { Component } from 'svelte';
	import type { SentryEventDetail, SentryIssue } from '$lib/server/sentry/types';

	// Detail modal for one issue. The summary (`issue`) is already in hand; the latest event's
	// exception + stacktrace ("which file/line, how & why") is fetched on open from /sentry/event.
	// `levelTone`/`seenAgo` are passed in so the table stays the single source of those helpers.
	let {
		issue,
		open = $bindable(false),
		levelTone,
		seenAgo
	}: {
		issue: SentryIssue | null;
		open?: boolean;
		levelTone: (level: string) => StatusTone;
		seenAgo: (iso: string) => string;
	} = $props();

	let detail = $state<SentryEventDetail | null>(null);
	let loading = $state(false);
	let failed = $state(false);

	// Refetch whenever a new issue is opened (keyed on id); abort if the dialog closes mid-flight.
	$effect(() => {
		const id = open ? issue?.id : null;
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

<BaseDialog bind:open class="max-w-2xl">
	{#if issue}
		<div class="flex items-start gap-3">
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-2 text-xs text-muted">
					{#if issue.shortId}<span class="font-mono">{issue.shortId}</span>{/if}
					<StatusBadge tone={levelTone(issue.level)} label={issue.level} />
				</div>
				<h2 class="mt-1 font-semibold break-words text-ink">{issue.title}</h2>
			</div>
			<IconButton
				icon={X as unknown as Component}
				label="Close"
				onclick={() => (open = false)}
			/>
		</div>

		<div class="mt-4 max-h-[60vh] space-y-4 overflow-y-auto">
			{#if loading}
				<div class="flex items-center gap-2 py-6 text-sm text-muted">
					<LoaderCircle class="h-4 w-4 animate-spin" aria-hidden="true" />
					Loading latest event…
				</div>
			{:else if failed}
				<div class="flex items-center gap-2 rounded-lg border border-border bg-surface p-4 text-sm text-muted">
					<TriangleAlert class="h-4 w-4 shrink-0" aria-hidden="true" />
					Couldn't load the event detail. The summary below is still current.
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
		</div>

		<div class="mt-5 flex items-center justify-end gap-2 border-t border-border pt-4">
			<form method="post" action="?/resolve" use:enhance={() => async ({ result, update }) => { if (result.type === 'success') open = false; await update(); }}>
				<input type="hidden" name="id" value={issue.id} />
				<button
					type="submit"
					class="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-bg px-3 text-sm font-medium text-ink transition-colors hover:border-brand/40 hover:bg-surface focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
				>
					<Check class="h-4 w-4" aria-hidden="true" /> Resolve
				</button>
			</form>
			<form method="post" action="?/ignore" use:enhance={() => async ({ result, update }) => { if (result.type === 'success') open = false; await update(); }}>
				<input type="hidden" name="id" value={issue.id} />
				<button
					type="submit"
					class="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-bg px-3 text-sm font-medium text-ink transition-colors hover:border-brand/40 hover:bg-surface focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
				>
					<BellOff class="h-4 w-4" aria-hidden="true" /> Ignore
				</button>
			</form>
			{#if issue.permalink}
				<!-- permalink is an absolute external Sentry URL, so resolve() doesn't apply here. -->
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					href={issue.permalink}
					target="_blank"
					rel="noopener noreferrer"
					class="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-bg px-3 text-sm font-medium text-ink transition-colors hover:border-brand/40 hover:bg-surface focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
				>
					Open in Sentry <ExternalLink class="h-4 w-4 text-muted" aria-hidden="true" />
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{/if}
		</div>
	{/if}
</BaseDialog>
