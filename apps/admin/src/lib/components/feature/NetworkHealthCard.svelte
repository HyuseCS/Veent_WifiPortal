<script lang="ts">
	import MapPin from 'lucide-svelte/icons/map-pin';
	import type { NetworkAp } from '$lib/types';
	import { Card, StatusBadge } from '$lib/components/ui';
	import MapPicker from './MapPicker.svelte';

	// `showMap` is driven by the page-level "Show/Hide all maps" toggle.
	let { ap, showMap = true }: { ap: NetworkAp; showMap?: boolean } = $props();

	// Metric rows rendered from data so the markup stays a single <dl> loop.
	const metrics = $derived([
		{ label: 'Uptime', value: ap.uptime },
		{ label: 'Latency', value: ap.latency },
		{ label: 'Users', value: String(ap.users) },
		{ label: 'Tput', value: ap.throughput }
	]);

	const placed = $derived(ap.latitude != null && ap.longitude != null);
	const latitude = $derived(ap.latitude ?? '');
	const longitude = $derived(ap.longitude ?? '');

	const toNum = (s: string): number | null => {
		const n = Number(s);
		return s.trim() !== '' && Number.isFinite(n) ? n : null;
	};
</script>

<Card padding="p-4">
	<div class="flex items-center justify-between gap-2">
		<h3 class="text-sm font-semibold text-ink">{ap.name}</h3>
		<StatusBadge tone={ap.tone} label={ap.status} />
	</div>
	<dl class="mt-4 grid grid-cols-4 divide-x divide-border text-center">
		{#each metrics as metric (metric.label)}
			<div class="px-2">
				<dt class="text-xs text-muted">{metric.label}</dt>
				<dd class="mt-0.5 font-mono text-sm font-semibold text-ink">{metric.value}</dd>
			</div>
		{/each}
	</dl>

	<div class="mt-4 border-t border-border pt-3">
		<div class="flex min-h-[28px] items-center gap-2 text-sm font-medium text-ink">
			<span
				class="inline-block h-2 w-2 rounded-full"
				style="background: {placed ? 'var(--color-online)' : 'var(--color-border)'}"
			></span>
			Map location
			<span class="text-xs font-normal text-muted">{placed ? 'on map' : 'not placed'}</span>
		</div>

		{#if showMap}
			<!-- Read-only snapshot of the saved pin. All placing/editing lives on /map (the
			     canonical pinning surface); the link below opens it focused on this AP. -->
			<div class="mt-3 space-y-2">
				{#if placed}
					<MapPicker height="h-40" autolocate={false} lat={toNum(latitude)} lng={toNum(longitude)} />
					<p class="font-mono text-xs text-muted">{latitude}, {longitude}</p>
					{#if ap.address}<p class="text-xs text-muted">{ap.address}</p>{/if}
				{/if}
				<a
					href="/map?ap={ap.id}"
					class="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-border bg-bg px-4 text-sm font-medium text-ink transition-colors hover:bg-surface"
				>
					<MapPin class="h-4 w-4" aria-hidden="true" />
					{placed ? 'Edit location on map' : 'Place on map'}
				</a>
			</div>
		{/if}
	</div>
</Card>
