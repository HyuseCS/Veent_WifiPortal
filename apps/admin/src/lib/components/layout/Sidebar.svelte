<script lang="ts">
	import { page, navigating } from '$app/state';
	import { browser } from '$app/environment';
	import LogOut from 'lucide-svelte/icons/log-out';
	import PanelLeftClose from 'lucide-svelte/icons/panel-left-close';
	import PanelLeftOpen from 'lucide-svelte/icons/panel-left-open';
	import ChevronsUpDown from 'lucide-svelte/icons/chevrons-up-down';
	import Settings from 'lucide-svelte/icons/settings';
	import { nav } from '$lib/nav';
	import { Avatar } from '$lib/components/ui';
	import ModeToggle from './ModeToggle.svelte';

	// Owner-only entries (e.g. Staff) are hidden for non-owners. This is cosmetic —
	// the routes themselves enforce access server-side.
	let {
		user,
		issuesUnread = 0
	}: {
		user?: { name?: string; email?: string; image?: string | null; role?: string | null };
		/** Unread incident-activity count → badge on the Incidents nav item. */
		issuesUnread?: number;
	} = $props();
	const items = $derived(nav.filter((item) => !item.ownerOnly || user?.role === 'owner'));

	// Which nav item (if any) carries the unread badge, and its capped display value.
	const badgeFor = (href: string) => (href === '/issues' ? issuesUnread : 0);
	const badgeLabel = (n: number) => (n > 99 ? '99+' : String(n));

	// Highlight the DESTINATION tab the instant a navigation starts, not after its `load` resolves,
	// so switching to a slow page (networks/sentry) feels immediate. Falls back to the committed
	// path when idle (see (app)/+layout.svelte navPath).
	const activePath = $derived(navigating.to?.url.pathname ?? page.url.pathname);

	// Collapsed state persists in localStorage (mirrors ModeToggle). ponytail: SSR renders
	// expanded, so a collapsed reload flashes wide for one frame — fine for an admin tool;
	// upgrade to a cookie + SSR read if the flash ever matters.
	let collapsed = $state(browser && localStorage.getItem('radius-admin-sidebar') === '1');
	function toggle() {
		collapsed = !collapsed;
		accountOpen = false; // don't leave the account menu floating over a resized rail
		try {
			localStorage.setItem('radius-admin-sidebar', collapsed ? '1' : '0');
		} catch {
			// localStorage unavailable (private mode) — collapse still applies for the session.
		}
	}

	// Account menu (avatar trigger → pop-up above holding profile, Mode toggle, Sign out).
	let accountOpen = $state(false);
	let triggerEl = $state<HTMLButtonElement>();
	let menuEl = $state<HTMLDivElement>();

	function closeAccount() {
		accountOpen = false;
		triggerEl?.focus(); // return focus to the trigger (a11y)
	}

	// Close on an outside click while open.
	$effect(() => {
		if (!accountOpen) return;
		const onDown = (e: PointerEvent) => {
			const t = e.target as Node;
			if (!menuEl?.contains(t) && !triggerEl?.contains(t)) accountOpen = false;
		};
		document.addEventListener('pointerdown', onDown, true);
		return () => document.removeEventListener('pointerdown', onDown, true);
	});

	// On open, move focus into the menu's first control.
	$effect(() => {
		if (accountOpen && menuEl) {
			menuEl.querySelector<HTMLElement>('button, [href]')?.focus();
		}
	});
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && accountOpen) {
			e.preventDefault();
			closeAccount();
		}
	}}
/>

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
				{@const active = activePath === item.href || activePath.startsWith(item.href + '/')}
				{@const badge = badgeFor(item.href)}
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
					<span class="relative shrink-0">
						<Icon
							class="h-5 w-5 transition-colors duration-150 {active
								? 'text-cta'
								: 'text-sidebar-muted group-hover:text-white'}"
						/>
						<!-- Collapsed rail: a dot on the icon stands in for the number pill. -->
						{#if badge > 0 && collapsed}
							<span
								class="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-cta ring-2 ring-sidebar"
								aria-hidden="true"
							></span>
						{/if}
					</span>
					{#if !collapsed}
						<span class="flex-1">{item.label}</span>
						{#if badge > 0}
							<span
								class="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-cta px-1.5 py-0.5 text-[11px] font-semibold text-white"
								aria-label="{badge} unread"
							>
								{badgeLabel(badge)}
							</span>
						{/if}
					{/if}
				</a>
			{/each}
		</div>
	</nav>

	<div class="relative border-t border-white/10 p-3">
		{#if accountOpen}
			<!-- Pop-up menu: opens upward from the trigger. Holds profile + Mode + Sign out. -->
			<div
				bind:this={menuEl}
				role="menu"
				aria-label="Account"
				class="absolute bottom-full left-3 z-50 mb-2 w-56 rounded-lg border border-white/10 bg-sidebar p-2 shadow-xl shadow-black/50"
			>
				{#if user}
					<div class="flex items-center gap-3 rounded-md px-2 py-2">
						<Avatar src={user.image} name={user.name} email={user.email} class="h-9 w-9 text-xs" />
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
					<div class="my-1.5 h-px bg-white/10"></div>
				{/if}

				<a
					href="/profile"
					role="menuitem"
					class="group flex min-h-[44px] w-full cursor-pointer items-center gap-3 rounded-md px-3 text-sm font-medium text-sidebar-text transition-all duration-150 outline-none hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-cta/60"
				>
					<Settings
						class="h-5 w-5 shrink-0 text-sidebar-muted transition-colors duration-150 group-hover:text-white"
						aria-hidden="true"
					/>
					Profile settings
				</a>
				<div class="my-1.5 h-px bg-white/10"></div>

				<div class="px-1 py-1">
					<ModeToggle />
				</div>
				<div class="my-1.5 h-px bg-white/10"></div>

				<form method="POST" action="/logout">
					<button
						type="submit"
						role="menuitem"
						class="group flex min-h-[44px] w-full cursor-pointer items-center gap-3 rounded-md px-3 text-sm font-medium text-sidebar-text transition-all duration-150 outline-none hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-cta/60 active:scale-[0.98]"
					>
						<LogOut
							class="h-5 w-5 shrink-0 text-sidebar-muted transition-colors duration-150 group-hover:text-white"
							aria-hidden="true"
						/>
						Sign out
					</button>
				</form>
			</div>
		{/if}

		<!-- Trigger: avatar + name + chevron. Everything else lives in the menu above. -->
		<button
			bind:this={triggerEl}
			type="button"
			onclick={() => (accountOpen = !accountOpen)}
			aria-haspopup="menu"
			aria-expanded={accountOpen}
			title={collapsed ? (user?.name ?? 'Account') : undefined}
			class="group flex min-h-[44px] w-full cursor-pointer items-center gap-3 rounded-md text-sm font-medium text-sidebar-text transition-all duration-150 outline-none hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-cta/60 {collapsed
				? 'justify-center px-0'
				: 'px-2'} {accountOpen ? 'bg-white/5 text-white' : ''}"
		>
			<Avatar src={user?.image} name={user?.name} email={user?.email} class="h-9 w-9 text-xs" />
			{#if !collapsed}
				<span class="min-w-0 flex-1 truncate text-left">{user?.name ?? 'Account'}</span>
				<ChevronsUpDown class="h-4 w-4 shrink-0 text-sidebar-muted" aria-hidden="true" />
			{/if}
		</button>
	</div>
</aside>
