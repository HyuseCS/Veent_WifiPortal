<script lang="ts">
	import AlertTriangle from 'lucide-svelte/icons/triangle-alert';
	import Activity from 'lucide-svelte/icons/activity';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import Users from 'lucide-svelte/icons/users';
	import type { Component } from 'svelte';
	import { resolve } from '$app/paths';
	import type { Kpi } from '$lib/types';
	import { KpiCard } from '$lib/components/feature';

	// Headline metrics row for the Sentry page — reuses the shared <KpiCard>. Icon/helper chrome
	// is matched by label (presentation only), the same pattern the Finance page uses. The
	// "Open issues" card links to the dedicated issues page on mobile (where the table is hidden);
	// `dashboardUrl` adds a 4th "Open in Sentry" deep-link card so the row reads as a full four.
	let { kpis, dashboardUrl = null }: { kpis: Kpi[]; dashboardUrl?: string | null } = $props();

	const icon = (c: unknown) => c as Component;
	const chrome: Record<string, { icon: Component; helper: string }> = {
		'Open issues': { icon: icon(AlertTriangle), helper: 'unresolved · last 14 days' },
		'Events (14d)': { icon: icon(Activity), helper: 'across open issues' },
		'Users affected': { icon: icon(Users), helper: 'across open issues' }
	};
</script>

<section class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
	{#each kpis as kpi (kpi.label)}
		{@const c = chrome[kpi.label]}
		{#if kpi.label === 'Open issues'}
			<!-- Mobile: the issues table lives on its own page, so tapping the card navigates there. -->
			<a href={resolve('/sentry/issues')} class="block md:hidden">
				<KpiCard {kpi} icon={c?.icon} helper="tap to view all issues" compact />
			</a>
			<!-- Desktop: static — the full table is inline just below. -->
			<div class="hidden md:block">
				<KpiCard {kpi} icon={c?.icon} helper={c?.helper} compact />
			</div>
		{:else}
			<KpiCard {kpi} icon={c?.icon} helper={c?.helper ?? ''} compact />
		{/if}
	{/each}

	{#if dashboardUrl}
		<!-- 4th card: the former Topbar "Open in Sentry" button. Absolute external URL, so
		     resolve() (for app-internal paths) doesn't apply here. -->
		<!-- eslint-disable svelte/no-navigation-without-resolve -->
		<a
			href={dashboardUrl}
			target="_blank"
			rel="noopener noreferrer"
			aria-label="Open in Sentry"
			class="group flex flex-col gap-2 rounded-xl border border-border bg-bg p-3 shadow-sm transition-[box-shadow,transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none sm:p-3.5"
		>
			<div class="flex items-start justify-between gap-2">
				<p class="text-xs font-semibold tracking-wide text-muted uppercase">Open in Sentry</p>
				<span
					class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand transition-[background-color,transform,color] duration-200 group-hover:scale-105 group-hover:bg-brand/20"
					aria-hidden="true"
				>
					<ExternalLink class="h-4 w-4" />
				</span>
			</div>
			<div class="flex flex-col gap-1">
				<p class="font-mono text-2xl font-bold tracking-tight text-ink">Open ↗</p>
				<span class="text-xs text-muted">full dashboard &amp; history</span>
			</div>
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	{/if}
</section>
