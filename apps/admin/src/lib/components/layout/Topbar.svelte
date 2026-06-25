<script lang="ts">
	import type { Snippet } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import RefreshCw from 'lucide-svelte/icons/refresh-cw';
	import { LiveStatusPill } from '$lib/components/ui';
	import { live, connectLive } from '$lib/live.svelte';

	// `actions` renders page-specific controls on the right (e.g. the dashboard layout switcher).
	let { title, subtitle, actions }: { title: string; subtitle?: string; actions?: Snippet } =
		$props();

	$effect(connectLive);

	// "Updated X ago" reflects when the live snapshot last changed. Stamp on each fresh
	// snapshot; a 1s tick re-renders the relative label. Display-only — the SSE stream is
	// untouched by any of this.
	let lastUpdate = $state(Date.now());
	let now = $state(Date.now());
	$effect(() => {
		if (live.snapshot) lastUpdate = Date.now();
	});
	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});
	const updatedLabel = $derived.by(() => {
		const s = Math.max(0, Math.round((now - lastUpdate) / 1000));
		if (s < 5) return 'just now';
		if (s < 60) return `${s}s ago`;
		const m = Math.floor(s / 60);
		if (m < 60) return `${m}m ago`;
		return `${Math.floor(m / 60)}h ago`;
	});

	// Manual refresh re-runs the page loaders (re-pulls the SSR data). The shared SSE stream
	// keeps pushing on its own — this is additive to live updates, not a replacement.
	let refreshing = $state(false);
	async function refresh() {
		if (refreshing) return;
		refreshing = true;
		try {
			await invalidateAll();
			lastUpdate = Date.now();
		} finally {
			refreshing = false;
		}
	}
</script>

<header
	class="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-bg px-4 sm:px-6"
>
	<div class="min-w-0">
		<div class="flex min-w-0 items-center gap-3">
			<h1 class="truncate text-lg font-semibold tracking-tight text-ink sm:text-xl">{title}</h1>
			<LiveStatusPill status={live.status} />
		</div>
		{#if subtitle}
			<p class="truncate text-xs text-muted">{subtitle}</p>
		{/if}
	</div>

	<div class="flex shrink-0 items-center gap-2 sm:gap-3">
		<span class="hidden text-xs text-muted sm:inline">Updated {updatedLabel}</span>
		<button
			type="button"
			onclick={refresh}
			disabled={refreshing}
			aria-label="Refresh data"
			class="flex h-11 w-11 cursor-pointer items-center justify-center rounded-md border border-border bg-bg text-muted outline-none transition-[background-color,color,transform,border-color] duration-150 hover:border-brand/40 hover:bg-surface hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/40 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
		>
			<RefreshCw class="h-4 w-4 {refreshing ? 'animate-spin' : ''}" aria-hidden="true" />
		</button>
		{#if actions}{@render actions()}{/if}
	</div>
</header>
