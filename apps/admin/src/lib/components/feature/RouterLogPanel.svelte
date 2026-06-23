<script lang="ts">
	import { onMount } from 'svelte';
	import WifiOff from 'lucide-svelte/icons/wifi-off';
	import RefreshCw from 'lucide-svelte/icons/refresh-cw';

	interface RouterLogEntry {
		time: string;
		topics: string;
		message: string;
	}

	let entries = $state<RouterLogEntry[]>([]);
	let error = $state('');
	let loading = $state(true);
	let live = $state(false);

	// Tint the topic chip by severity so warnings/errors stand out on the dark terminal.
	function topicColor(topics: string): string {
		if (/error|critical|alert|emerg/i.test(topics)) return 'var(--color-blocked)';
		if (/warning/i.test(topics)) return 'var(--color-warning)';
		return '#8aa0d8';
	}

	async function load() {
		try {
			const res = await fetch('/api/router-log');
			if (!res.ok) throw new Error(String(res.status));
			const data = (await res.json()) as { entries?: RouterLogEntry[]; error?: string };
			entries = data.entries ?? [];
			error = data.error ?? '';
			live = !data.error;
		} catch {
			error = 'Unreachable';
			live = false;
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		load();
		// External resource (the router), not the DB — a modest poll is fine. Each
		// fetch opens one router API connection, so don't go faster than needed.
		const id = setInterval(load, 5000);
		return () => clearInterval(id);
	});
</script>

<aside
	class="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-sm"
>
	<header class="flex shrink-0 items-center justify-between gap-2 px-5 pt-4 pb-3">
		<h2 class="text-base font-semibold text-ink">Router Log</h2>
		<span
			class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold {live
				? 'bg-online/15 text-online'
				: 'bg-blocked/15 text-blocked'}"
		>
			<span
				class="h-1.5 w-1.5 rounded-full {live ? 'bg-online' : 'bg-blocked'}"
				aria-hidden="true"
			></span>
			{live ? 'Streaming' : 'Offline'}
		</span>
	</header>

	<div class="min-h-0 flex-1 px-4 pb-4">
		{#if loading}
			<p class="px-1 py-6 text-center text-sm text-muted">Loading…</p>
		{:else if live && entries.length > 0}
			<!-- Terminal feed: dark regardless of theme, mono lines. -->
			<div
				class="h-full min-h-37.5 overflow-y-auto rounded-xl px-3.5 py-3 font-mono text-[11.5px] leading-relaxed"
				style="background: #0c1430; color: #cdd6f0;"
			>
				{#each entries as e, i (i)}
					<div class="flex gap-2.5">
						<span class="shrink-0" style="color: #5f6c92;">{e.time}</span>
						<span class="shrink-0 font-semibold" style="color: {topicColor(e.topics)}">{e.topics}</span>
						<span class="break-all">{e.message}</span>
					</div>
				{/each}
			</div>
		{:else}
			<!-- Offline / empty: explain + offer a manual re-poll. -->
			<div
				class="flex h-full min-h-37.5 flex-col items-center justify-center gap-3.5 rounded-xl border border-dashed border-border bg-surface p-6 text-center"
			>
				<span
					class="flex h-11 w-11 items-center justify-center rounded-xl bg-blocked/10 text-blocked"
					aria-hidden="true"
				>
					<WifiOff class="h-5 w-5" />
				</span>
				<div class="leading-snug">
					<p class="text-sm font-semibold text-ink">
						{error ? 'Router log unavailable' : 'No log entries'}
					</p>
					<p class="mt-1 text-xs text-muted">
						{error
							? "The local gateway isn't streaming accounting data."
							: 'Entries appear here as devices authenticate and accounting updates arrive.'}
					</p>
				</div>
				<button
					type="button"
					onclick={load}
					class="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold text-ink transition-colors duration-150 hover:border-brand/40 hover:text-brand"
				>
					<RefreshCw class="h-3.5 w-3.5" aria-hidden="true" />
					Reconnect
				</button>
			</div>
		{/if}
	</div>
</aside>
