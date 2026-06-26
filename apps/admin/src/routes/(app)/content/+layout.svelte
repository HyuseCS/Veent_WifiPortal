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
	<nav class="flex w-fit gap-1 rounded-xl border border-border bg-bg p-1 shadow-sm">
		{#each tabs as t (t.href)}
			<a
				href={t.href}
				aria-current={isActive(t.href) ? 'page' : undefined}
				class="flex min-h-[44px] items-center rounded-lg px-3.5 text-xs font-bold transition-colors duration-150 {isActive(
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
