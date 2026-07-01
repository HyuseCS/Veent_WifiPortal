<script lang="ts">
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import LogOut from 'lucide-svelte/icons/log-out';
	import PanelLeftClose from 'lucide-svelte/icons/panel-left-close';
	import PanelLeftOpen from 'lucide-svelte/icons/panel-left-open';
	import Activity from 'lucide-svelte/icons/activity';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import { env } from '$env/dynamic/public';
	import { nav } from '$lib/nav';
	import ModeToggle from './ModeToggle.svelte';

	// Owner-only entries (e.g. Staff) are hidden for non-owners. This is cosmetic —
	// the routes themselves enforce access server-side.
	let { user }: { user?: { name?: string; email?: string; role?: string | null } } = $props();
	const items = $derived(nav.filter((item) => !item.ownerOnly || user?.role === 'owner'));

	// External link to the Sentry project dashboard. Renders ONLY when the URL is set
	// (fail-open — no env, no link) and only for the owner. Kept out of `nav` because that
	// array is for internal routes with active-state matching; this opens Sentry in a new tab.
	const sentryUrl = env.PUBLIC_SENTRY_DASHBOARD_URL;
	const showSentry = $derived(!!sentryUrl && user?.role === 'owner');
	const initials = $derived(
		(user?.name ?? user?.email ?? '?')
			.trim()
			.split(/\s+/)
			.slice(0, 2)
			.map((w) => w[0]?.toUpperCase() ?? '')
			.join('')
	);

	// Collapsed state persists in localStorage (mirrors ModeToggle). ponytail: SSR renders
	// expanded, so a collapsed reload flashes wide for one frame — fine for an admin tool;
	// upgrade to a cookie + SSR read if the flash ever matters.
	let collapsed = $state(browser && localStorage.getItem('radius-admin-sidebar') === '1');
	function toggle() {
		collapsed = !collapsed;
		try {
			localStorage.setItem('radius-admin-sidebar', collapsed ? '1' : '0');
		} catch {
			// localStorage unavailable (private mode) — collapse still applies for the session.
		}
	}
</script>

<aside
	class="hidden shrink-0 flex-col bg-sidebar text-sidebar-text transition-[width] duration-200 md:flex {collapsed
		? 'w-16'
		: 'w-60'}"
>
	<div
		class="flex h-16 items-center gap-2.5 border-b border-white/5 {collapsed
			? 'justify-center px-0'
			: 'px-5'}"
	>
		{#if !collapsed}
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
		{/if}
		<button
			type="button"
			onclick={toggle}
			aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
			aria-pressed={collapsed}
			title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
			class="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-muted outline-none transition-colors duration-150 hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-cta/60 {collapsed
				? ''
				: 'ml-auto'}"
		>
			{#if collapsed}
				<PanelLeftOpen class="h-5 w-5" aria-hidden="true" />
			{:else}
				<PanelLeftClose class="h-5 w-5" aria-hidden="true" />
			{/if}
		</button>
	</div>

	<nav class="flex-1 overflow-y-auto px-3 py-4">
		{#if !collapsed}
			<p class="px-3 pb-2 text-[10px] font-semibold tracking-wider text-sidebar-muted uppercase">
				Overview
			</p>
		{/if}
		<div class="space-y-1">
			{#each items as item (item.href)}
				{@const Icon = item.icon}
				{@const active =
					page.url.pathname === item.href || page.url.pathname.startsWith(item.href + '/')}
				<a
					href={item.href}
					aria-current={active ? 'page' : undefined}
					title={collapsed ? item.label : undefined}
					class="group relative flex min-h-[44px] items-center gap-3 rounded-md text-sm font-medium transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-cta/60 {collapsed
						? 'justify-center px-0'
						: 'px-3'} {active
						? 'bg-cta/15 text-white'
						: 'text-sidebar-text hover:bg-white/5 hover:text-white'}"
				>
					{#if active}
						<span
							class="absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-full bg-cta"
							aria-hidden="true"
						></span>
					{/if}
					<Icon
						class="h-5 w-5 shrink-0 transition-colors duration-150 {active
							? 'text-cta'
							: 'text-sidebar-muted group-hover:text-white'}"
					/>
					{#if !collapsed}{item.label}{/if}
				</a>
			{/each}

			{#if showSentry}
				<a
					href={sentryUrl}
					target="_blank"
					rel="noopener noreferrer"
					title={collapsed ? 'Sentry dashboard' : undefined}
					class="group relative flex min-h-[44px] items-center gap-3 rounded-md text-sm font-medium text-sidebar-text transition-all duration-150 outline-none hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-cta/60 {collapsed
						? 'justify-center px-0'
						: 'px-3'}"
				>
					<Activity
						class="h-5 w-5 shrink-0 text-sidebar-muted transition-colors duration-150 group-hover:text-white"
						aria-hidden="true"
					/>
					{#if !collapsed}
						<span class="flex-1">Sentry</span>
						<ExternalLink class="h-3.5 w-3.5 shrink-0 text-sidebar-muted" aria-hidden="true" />
					{/if}
				</a>
			{/if}
		</div>
	</nav>

	<div class="border-t border-white/10 p-3">
		{#if !collapsed}
			<ModeToggle />

			{#if user}
				<div
					class="mt-3 flex items-center gap-3 rounded-md bg-white/5 px-2.5 py-2 transition-colors duration-150 hover:bg-white/10"
				>
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
		{/if}

		<form method="POST" action="/logout" class="mt-2">
			<button
				type="submit"
				title={collapsed ? 'Sign out' : undefined}
				class="group flex min-h-[44px] w-full cursor-pointer items-center gap-3 rounded-md text-sm font-medium text-sidebar-text transition-all duration-150 outline-none hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-cta/60 active:scale-[0.98] {collapsed
					? 'justify-center px-0'
					: 'px-3'}"
			>
				<LogOut
					class="h-5 w-5 shrink-0 text-sidebar-muted transition-colors duration-150 group-hover:text-white"
					aria-hidden="true"
				/>
				{#if !collapsed}Sign out{/if}
			</button>
		</form>
	</div>
</aside>
