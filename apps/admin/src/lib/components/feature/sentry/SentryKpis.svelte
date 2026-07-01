<script lang="ts">
	import AlertTriangle from 'lucide-svelte/icons/triangle-alert';
	import Activity from 'lucide-svelte/icons/activity';
	import Users from 'lucide-svelte/icons/users';
	import type { Component } from 'svelte';
	import type { Kpi } from '$lib/types';
	import { KpiCard } from '$lib/components/feature';

	// Headline metrics row for the Sentry page — reuses the shared <KpiCard>. Icon/helper chrome
	// is matched by label (presentation only), the same pattern the Finance page uses.
	let { kpis }: { kpis: Kpi[] } = $props();

	const icon = (c: unknown) => c as Component;
	const chrome: Record<string, { icon: Component; helper: string }> = {
		'Open issues': { icon: icon(AlertTriangle), helper: 'unresolved · last 14 days' },
		'Events (14d)': { icon: icon(Activity), helper: 'accepted errors' },
		'Users affected': { icon: icon(Users), helper: 'across open issues' }
	};
</script>

<section class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
	{#each kpis as kpi (kpi.label)}
		{@const c = chrome[kpi.label]}
		<KpiCard {kpi} icon={c?.icon} helper={c?.helper ?? ''} compact />
	{/each}
</section>
