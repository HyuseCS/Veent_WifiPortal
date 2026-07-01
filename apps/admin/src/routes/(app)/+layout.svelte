<script lang="ts">
	import { type Snippet } from 'svelte';
	import { page } from '$app/state';
	import { Sidebar, MobileDrawer, Topbar } from '$lib/components/layout';
	import {
		FinanceHeaderControls,
		NetworkHeaderControls,
		SentryHeaderControls
	} from '$lib/components/feature';
	import { nav } from '$lib/nav';
	import { mobileNav } from '$lib/uiState.svelte';
	import { editLock } from '$lib/edit-lock.svelte';
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
		'/content': 'Packages, FAQ & session limits',
		'/staff': 'Admin access management',
		'/sentry': 'Error monitoring'
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
	const onSentryIssues = $derived(page.url.pathname === '/sentry/issues');
</script>

<div class="flex h-dvh overflow-hidden bg-bg">
	<Sidebar user={data.user} />
	<MobileDrawer user={data.user} />
	<!-- Background goes inert while the mobile drawer is open → focus can't leave the drawer.
	     On desktop the drawer never opens, so this is never inert. -->
	<div class="flex flex-1 flex-col overflow-hidden" inert={mobileNav.open ? true : undefined}>
		<Topbar {title} {subtitle}>
			{#snippet actions()}
				{#if onFinance}<FinanceHeaderControls />{/if}
			{#if onNetworks}<NetworkHeaderControls />{/if}
			{#if onSentryIssues}<SentryHeaderControls />{/if}
			{/snippet}
		</Topbar>
		<main
			class="flex-1 overflow-y-auto bg-canvas {onSentryIssues
				? ''
				: 'p-4 sm:p-6'} {onNetworks
				? `[scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${editLock.active ? '' : 'md:snap-y md:snap-proximity'}`
				: ''}"
		>
			{@render children()}
		</main>
	</div>
</div>
