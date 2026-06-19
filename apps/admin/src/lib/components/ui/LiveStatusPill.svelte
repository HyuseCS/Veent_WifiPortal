<script lang="ts">
	import type { LiveStatus } from '$lib/live.svelte';

	/**
	 * Connection status as a polished pill (Live / Connecting / Offline) — the topbar's
	 * read-out for the shared SSE stream. Tone follows the status: online green when live,
	 * warning amber while connecting, blocked red when the stream gave up. The dot pings
	 * only while live so a steady state never looks busy.
	 */
	let { status = 'connecting' }: { status?: LiveStatus } = $props();

	const meta = $derived(
		status === 'live'
			? { label: 'Live', fill: 'bg-online/15 text-online', dot: 'bg-online' }
			: status === 'connecting'
				? { label: 'Connecting', fill: 'bg-warning/15 text-warning', dot: 'bg-warning' }
				: { label: 'Offline', fill: 'bg-blocked/15 text-blocked', dot: 'bg-blocked' }
	);
</script>

<span
	class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium {meta.fill}"
>
	<span class="relative flex h-1.5 w-1.5" aria-hidden="true">
		{#if status === 'live'}
			<span
				class="absolute inline-flex h-full w-full animate-ping rounded-full {meta.dot} opacity-60"
			></span>
		{/if}
		<span class="relative inline-flex h-1.5 w-1.5 rounded-full {meta.dot}"></span>
	</span>
	{meta.label}
</span>
