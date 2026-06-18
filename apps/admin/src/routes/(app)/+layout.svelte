<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { Sidebar, Topbar } from '$lib/components/layout';
	import { nav } from '$lib/nav';
	import type { LayoutData } from './$types';

	let { children, data }: { children: Snippet; data: LayoutData } = $props();

	const title = $derived(
		nav.find(
			(n) => page.url.pathname === n.href || page.url.pathname.startsWith(n.href + '/')
		)?.label ?? 'Admin'
	);
</script>

<div class="flex h-screen overflow-hidden bg-bg">
	<Sidebar user={data.user} />
	<div class="flex flex-1 flex-col overflow-hidden">
		<Topbar {title} />
		<main class="flex-1 overflow-y-auto p-6">
			{@render children()}
		</main>
	</div>
</div>
