<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	// Sub-sections of Content Management. Each is its own route (own load/actions).
	const tabs = [
		{ href: '/content/packages', label: 'Packages' },
		{ href: '/content/faq', label: 'FAQ' },
		{ href: '/content/limits', label: 'Session Limits' }
	];
	const isActive = (href: string) =>
		page.url.pathname === href || page.url.pathname.startsWith(href + '/');
</script>

<div class="space-y-5">
	<!-- Mobile: horizontal-scroll strip so all tabs stay reachable < sm; desktop is unchanged
	     (w-fit content-width pill, overflow visible from sm up). -->
	<nav
		class="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-bg p-1 shadow-sm [scrollbar-width:none] sm:overflow-visible [&::-webkit-scrollbar]:hidden"
	>
		{#each tabs as t (t.href)}
			<a
				href={t.href}
				aria-current={isActive(t.href) ? 'page' : undefined}
				class="flex min-h-[44px] shrink-0 items-center rounded-lg px-3.5 text-xs font-bold transition-colors duration-150 {isActive(
					t.href
				)
					? 'bg-brand text-white'
					: 'text-muted hover:text-ink'}"
			>
				{t.label}
			</a>
		{/each}
	</nav>

	{@render children()}
</div>
