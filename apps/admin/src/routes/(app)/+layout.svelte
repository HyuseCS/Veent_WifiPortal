<script lang="ts">
	import { type Snippet } from 'svelte';
	import { navigating, page } from '$app/state';
	import { RouteSkeleton } from '$lib/components/ui';
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

	// Optimistic path: the instant a cross-page navigation starts, reflect the DESTINATION in the
	// chrome (title, subtitle, header controls — and the sidebar highlight, which reads the same
	// `navigating` state) so the tab visibly switches BEFORE the target's `load` resolves. The body
	// shows RouteSkeleton meanwhile (see routeLoading below). Falls back to the committed path when
	// idle, or when navigating.to is null (e.g. leaving the app).
	const navPath = $derived(navigating.to?.url.pathname ?? page.url.pathname);

	const title = $derived(
		navPath.startsWith('/profile')
			? 'Profile settings'
			: (nav.find((n) => navPath === n.href || navPath.startsWith(n.href + '/'))?.label ?? 'Admin')
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
		'/sentry': 'Error monitoring',
		'/profile': 'Your account & security'
	};
	const subtitle = $derived(
		subtitles[
			Object.keys(subtitles).find(
				(href) => navPath === href || navPath.startsWith(href + '/')
			) ?? ''
		]
	);
	const onFinance = $derived(navPath.startsWith('/finance'));
	// Networks page opts into vertical scroll-snap (two full-screen sections). Scoped here
	// so the snap + hidden scrollbar apply only on that route, not the whole admin.
	const onNetworks = $derived(navPath.startsWith('/networks'));
	const onSentryIssues = $derived(navPath === '/sentry/issues');

	// Cross-route navigation only: SvelteKit blocks on the target's `load`, so swap in a neutral
	// skeleton while it resolves (see RouteSkeleton). Same-route reloads (e.g. the finance period
	// switch, where to/from pathname match) are left to each page's own in-place skeleton.
	const routeLoading = $derived(
		!!navigating.to && navigating.to.url.pathname !== page.url.pathname
	);

	// Base scroll container, minus the default padding on the full-bleed Sentry-issues table, plus
	// the Networks-only scroll-snap (suspended while an edit lock is held).
	const mainClass = $derived(
		[
			'flex-1 overflow-y-auto bg-canvas',
			onSentryIssues ? '' : 'p-4 sm:p-6',
			onNetworks
				? `[scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${editLock.active ? '' : 'md:snap-y md:snap-proximity'}`
				: ''
		]
			.filter(Boolean)
			.join(' ')
	);
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
		<main class={mainClass} aria-busy={routeLoading || undefined}>
			{#if routeLoading}
				<RouteSkeleton />
			{:else}
				<!-- Keyed on pathname so the entrance animation re-fires on each route change; the
				     wrapper is h-full so height-dependent page roots (users/staff/finance/logs use
				     `h-full`) still resolve against a full-height parent. -->
				{#key page.url.pathname}
					<div class="h-full animate-fade-in-up">
						{@render children()}
					</div>
				{/key}
			{/if}
		</main>
	</div>
</div>
