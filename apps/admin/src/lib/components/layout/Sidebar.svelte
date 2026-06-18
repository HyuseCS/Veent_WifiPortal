<script lang="ts">
	import { page } from '$app/state';
	import { nav } from '$lib/nav';
	import ModeToggle from './ModeToggle.svelte';

	// Owner-only entries (e.g. Staff) are hidden for non-owners. This is cosmetic —
	// the routes themselves enforce access server-side.
	let { role }: { role?: string | null } = $props();
	const items = $derived(nav.filter((item) => !item.ownerOnly || role === 'owner'));
</script>

<aside class="flex w-60 shrink-0 flex-col bg-sidebar text-sidebar-text">
	<div class="flex h-14 items-center gap-2.5 px-5">
		<div
			class="flex h-7 w-7 items-center justify-center rounded-md bg-cta text-sm font-bold text-white"
		>
			V
		</div>
		<span class="text-base font-semibold tracking-tight text-white">
			Veent <span class="text-sidebar-muted">Admin</span>
		</span>
	</div>

	<nav class="flex-1 space-y-0.5 px-3 py-2">
		{#each items as item (item.href)}
			{@const Icon = item.icon}
			{@const active =
				page.url.pathname === item.href || page.url.pathname.startsWith(item.href + '/')}
			<a
				href={item.href}
				aria-current={active ? 'page' : undefined}
				class="relative flex min-h-[44px] items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors {active
					? 'bg-cta/15 text-white'
					: 'text-sidebar-text hover:bg-white/5'}"
			>
				{#if active}
					<span
						class="absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-full bg-cta"
						aria-hidden="true"
					></span>
				{/if}
				<Icon class="h-5 w-5 {active ? 'text-cta' : 'text-sidebar-muted'}" />
				{item.label}
			</a>
		{/each}
	</nav>

	<div class="border-t border-white/10 p-3">
		<ModeToggle />
	</div>
</aside>
