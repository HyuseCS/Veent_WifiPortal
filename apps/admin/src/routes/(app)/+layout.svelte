<script lang="ts">
	import { setContext, untrack, type Snippet } from 'svelte';
	import { page } from '$app/state';
	import { Sidebar, Topbar, LayoutSwitcher } from '$lib/components/layout';
	import { nav } from '$lib/nav';
	import {
		DASH_LAYOUT_CTX,
		DASH_LAYOUT_COOKIE,
		type DashLayout,
		type DashLayoutCtx
	} from '$lib/dashboard-layout';
	import type { LayoutData } from './$types';

	let { children, data }: { children: Snippet; data: LayoutData } = $props();

	const title = $derived(
		nav.find(
			(n) => page.url.pathname === n.href || page.url.pathname.startsWith(n.href + '/')
		)?.label ?? 'Admin'
	);
	const onDashboard = $derived(page.url.pathname === '/dashboard');

	// Dashboard layout choice lives here (the header switcher and the dashboard grid both
	// need it). Seed once from the cookie-backed load value; selecting one rewrites the
	// cookie client-side without a reload, so we own it in memory thereafter.
	let dashLayout = $state<DashLayout>(untrack(() => data.dashLayout));
	setContext<DashLayoutCtx>(DASH_LAYOUT_CTX, {
		get current() {
			return dashLayout;
		},
		choose(value) {
			dashLayout = value;
			document.cookie = `${DASH_LAYOUT_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
		}
	});
</script>

<div class="flex h-screen overflow-hidden bg-bg">
	<Sidebar user={data.user} />
	<div class="flex flex-1 flex-col overflow-hidden">
		<Topbar {title}>
			{#snippet actions()}
				{#if onDashboard}<LayoutSwitcher />{/if}
			{/snippet}
		</Topbar>
		<main class="flex-1 overflow-y-auto p-6">
			{@render children()}
		</main>
	</div>
</div>
