<script lang="ts">
	import { onMount } from 'svelte';

	interface RouterLogEntry {
		time: string;
		topics: string;
		message: string;
	}

	let entries = $state<RouterLogEntry[]>([]);
	let error = $state('');
	let loading = $state(true);
	let live = $state(false);

	// Tint the topic chip by severity so warnings/errors stand out.
	function topicColor(topics: string): string {
		if (/error|critical|alert|emerg/i.test(topics)) return 'var(--color-blocked)';
		if (/warning/i.test(topics)) return 'var(--color-warning)';
		return 'var(--color-muted)';
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

<aside class="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-bg">
	<header class="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
		<span class="text-sm font-semibold text-ink">Router Log</span>
		<span class="flex items-center gap-1.5 text-xs text-muted">
			<span
				class="inline-block h-2 w-2 rounded-full"
				style="background: {live ? 'var(--color-online)' : 'var(--color-blocked)'}"
			></span>
			{live ? 'Live' : 'Offline'}
		</span>
	</header>

	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if loading}
			<p class="px-4 py-6 text-center text-sm text-muted">Loading…</p>
		{:else if entries.length === 0}
			<p class="px-4 py-6 text-center text-sm text-muted">
				{error || 'No log entries.'}
			</p>
		{:else}
			<ul class="divide-y divide-border">
				{#each entries as e, i (i)}
					<li class="px-3 py-2 text-xs">
						<div class="flex items-center justify-between gap-2">
							<span class="font-mono text-muted">{e.time}</span>
							<span class="truncate font-medium" style="color: {topicColor(e.topics)}">
								{e.topics}
							</span>
						</div>
						<p class="mt-0.5 break-words text-ink">{e.message}</p>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</aside>
