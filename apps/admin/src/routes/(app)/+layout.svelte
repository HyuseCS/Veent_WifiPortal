<script lang="ts">
	import { type Snippet } from 'svelte';
	import { page } from '$app/state';
	import { Sidebar, Topbar } from '$lib/components/layout';
	import { FinanceHeaderControls } from '$lib/components/feature';
	import { nav } from '$lib/nav';
	import type { LayoutData } from './$types';

	let { children, data }: { children: Snippet; data: LayoutData } = $props();

	const title = $derived(
		nav.find((n) => page.url.pathname === n.href || page.url.pathname.startsWith(n.href + '/'))
			?.label ?? 'Admin'
	);

	// One-line context per section — purely descriptive header copy (no data).
	const subtitles: Record<string, string> = {
		'/dashboard': 'Live operations overview',
		'/networks': 'Access point health & coverage',
		'/map': 'Access point locations',
		'/users': 'Guests, credits & sessions',
		'/finance': 'Settled revenue & payments',
		'/staff': 'Admin access management'
	};
	const subtitle = $derived(
		subtitles[
			Object.keys(subtitles).find(
				(href) => page.url.pathname === href || page.url.pathname.startsWith(href + '/')
			) ?? ''
		]
	);
	const onFinance = $derived(page.url.pathname.startsWith('/finance'));
	// Networks page opts into vertical scroll-snap (two full-screen sections). Scoped here
	// so the snap + hidden scrollbar apply only on that route, not the whole admin.
	const onNetworks = $derived(page.url.pathname.startsWith('/networks'));
</script>

<div class="flex h-screen overflow-hidden bg-bg">
	<Sidebar user={data.user} />
	<div class="flex flex-1 flex-col overflow-hidden">
		<Topbar {title} {subtitle}>
			{#snippet actions()}
				{#if onFinance}<FinanceHeaderControls />{/if}
			{/snippet}
		</Topbar>
		<main
			class="flex-1 overflow-y-auto bg-canvas p-4 sm:p-6 {onNetworks
				? 'snap-y snap-proximity [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
				: ''}"
		>
			{@render children()}
		</main>
	</div>
</div>
