<script lang="ts">
	import { page } from '$app/state';
	import LogOut from 'lucide-svelte/icons/log-out';
	import { nav } from '$lib/nav';
	import ModeToggle from './ModeToggle.svelte';

	// Owner-only entries (e.g. Staff) are hidden for non-owners. This is cosmetic —
	// the routes themselves enforce access server-side.
	let { user }: { user?: { name?: string; email?: string; role?: string | null } } = $props();
	const items = $derived(nav.filter((item) => !item.ownerOnly || user?.role === 'owner'));
	const initials = $derived(
		(user?.name ?? user?.email ?? '?')
			.trim()
			.split(/\s+/)
			.slice(0, 2)
			.map((w) => w[0]?.toUpperCase() ?? '')
			.join('')
	);
</script>

<aside class="flex w-60 shrink-0 flex-col bg-sidebar text-sidebar-text">
	<div class="flex h-16 items-center gap-2.5 border-b border-white/5 px-5">
		<div
			class="flex h-8 w-8 items-center justify-center rounded-lg bg-cta text-sm font-bold text-white shadow-sm shadow-black/40"
			aria-hidden="true"
		>
			R
		</div>
		<div class="flex flex-col leading-none">
			<span class="text-base font-semibold tracking-tight text-white">
				RADIUS <span class="text-sidebar-muted">Admin</span>
			</span>
			<span class="mt-1 text-[10px] font-medium tracking-wide text-sidebar-muted uppercase"
				>by Parafiber</span
			>
		</div>
	</div>

	<nav class="flex-1 overflow-y-auto px-3 py-4">
		<p class="px-3 pb-2 text-[10px] font-semibold tracking-wider text-sidebar-muted uppercase">
			Overview
		</p>
		<div class="space-y-1">
			{#each items as item (item.href)}
				{@const Icon = item.icon}
				{@const active =
					page.url.pathname === item.href || page.url.pathname.startsWith(item.href + '/')}
				<a
					href={item.href}
					aria-current={active ? 'page' : undefined}
					class="relative flex min-h-[44px] items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors {active
						? 'bg-cta/15 text-white'
						: 'text-sidebar-text hover:bg-white/5 hover:text-white'}"
				>
					{#if active}
						<span
							class="absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-full bg-cta"
							aria-hidden="true"
						></span>
					{/if}
					<Icon class="h-5 w-5 shrink-0 {active ? 'text-cta' : 'text-sidebar-muted'}" />
					{item.label}
				</a>
			{/each}
		</div>
	</nav>

	<div class="border-t border-white/10 p-3">
		<ModeToggle />

		{#if user}
			<div class="mt-3 flex items-center gap-3 rounded-md bg-white/5 px-2.5 py-2">
				<div
					class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cta text-xs font-semibold text-white"
					aria-hidden="true"
				>
					{initials}
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-1.5">
						{#if user.name}
							<p class="truncate text-sm font-medium text-white">{user.name}</p>
						{/if}
						{#if user.role}
							{@const isOwner = user.role === 'owner'}
							<span
								class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase {isOwner
									? 'bg-highlight/15 text-highlight'
									: 'bg-white/10 text-sidebar-text'}"
							>
								{user.role}
							</span>
						{/if}
					</div>
					{#if user.email}
						<p class="truncate text-xs text-sidebar-muted" title={user.email}>{user.email}</p>
					{/if}
				</div>
			</div>
		{/if}

		<form method="POST" action="/logout" class="mt-2">
			<button
				type="submit"
				class="flex min-h-[44px] w-full cursor-pointer items-center gap-3 rounded-md px-3 text-sm font-medium text-sidebar-text transition-colors hover:bg-white/5 hover:text-white"
			>
				<LogOut class="h-5 w-5 text-sidebar-muted" aria-hidden="true" />
				Sign out
			</button>
		</form>
	</div>
</aside>
