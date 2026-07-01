<script lang="ts">
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import X from 'lucide-svelte/icons/x';
	import LogOut from 'lucide-svelte/icons/log-out';
	import Activity from 'lucide-svelte/icons/activity';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import ChevronsUpDown from 'lucide-svelte/icons/chevrons-up-down';
	import { env } from '$env/dynamic/public';
	import { nav } from '$lib/nav';
	import { mobileNav } from '$lib/uiState.svelte';
	import ModeToggle from './ModeToggle.svelte';

	// Mobile-only off-canvas nav. Deliberately a SEPARATE component from Sidebar.svelte so the
	// desktop sidebar stays untouched (it only gains `hidden md:flex`). The ~nav markup is
	// duplicated here on purpose — the cost of a provably-unchanged desktop path.
	// ponytail: dup over a shared child that would force edits into the frozen desktop sidebar.
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

	// Owner-only external Sentry dashboard link — mirrors Sidebar.svelte (fail-open on the env URL).
	const sentryUrl = env.PUBLIC_SENTRY_DASHBOARD_URL;
	const showSentry = $derived(!!sentryUrl && user?.role === 'owner');

	let closeBtn = $state<HTMLButtonElement>();

	// Account menu (avatar trigger → pop-up holding profile, Mode toggle, Sign out) — mirrors Sidebar.
	let accountOpen = $state(false);
	let triggerEl = $state<HTMLButtonElement>();
	let menuEl = $state<HTMLDivElement>();

	function closeAccount() {
		accountOpen = false;
		triggerEl?.focus();
	}

	// Reset the account menu whenever the drawer closes, so it never reopens mid-flight.
	$effect(() => {
		if (!mobileNav.open) accountOpen = false;
	});

	// Close the account menu on an outside tap (within the drawer) while it's open.
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

	// Tapping a nav link navigates — dismiss the drawer once the destination loads.
	afterNavigate(() => (mobileNav.open = false));

	// While open: focus the panel, lock background scroll, and close on Esc. The background
	// column is marked `inert` in (app)/+layout.svelte, so focus can't escape the panel (a free
	// focus-trap). This only ever runs on mobile, where the drawer can open.
	$effect(() => {
		if (!mobileNav.open) return;
		const prev = document.activeElement as HTMLElement | null;
		closeBtn?.focus();
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			// Esc closes the account menu first (if open), otherwise dismisses the whole drawer.
			if (accountOpen) closeAccount();
			else mobileNav.open = false;
		};
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('keydown', onKey);
			document.body.style.overflow = prevOverflow;
			prev?.focus();
		};
	});
</script>

<!-- Backdrop — mobile only; click to dismiss. Fades via CSS (reduced-motion collapses it).
     z-[1090]/[1100] (not z-40/50): on /map, Leaflet's panes + controls reach z-1000 and the
     map container makes no stacking context, so a lower nav overlay sinks under the map. -->
<div
	class="fixed inset-0 z-[1090] bg-black/50 transition-opacity duration-200 md:hidden {mobileNav.open
		? 'opacity-100'
		: 'pointer-events-none opacity-0'}"
	aria-hidden="true"
	onclick={() => (mobileNav.open = false)}
></div>

<!-- Off-canvas panel — slides via CSS transform. Always in the DOM, but `inert` + off-screen
     when closed so its links stay out of the tab order. `md:hidden` removes it on desktop. -->
<div
	id="mobile-nav-drawer"
	class="fixed inset-y-0 left-0 z-[1100] flex h-dvh w-72 flex-col bg-sidebar text-sidebar-text shadow-xl transition-transform duration-200 md:hidden {mobileNav.open
		? 'translate-x-0'
		: '-translate-x-full'}"
	role="dialog"
	aria-modal="true"
	aria-label="Main navigation"
	inert={!mobileNav.open}
>
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
		<button
			bind:this={closeBtn}
			type="button"
			onclick={() => (mobileNav.open = false)}
			aria-label="Close navigation menu"
			class="ml-auto flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-muted outline-none transition-colors duration-150 hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-cta/60"
		>
			<X class="h-5 w-5" aria-hidden="true" />
		</button>
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
					class="group relative flex min-h-[44px] items-center gap-3 rounded-md px-3 text-sm font-medium transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-cta/60 {active
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
					{item.label}
				</a>
			{/each}

			{#if showSentry}
				<a
					href={sentryUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="group relative flex min-h-[44px] items-center gap-3 rounded-md px-3 text-sm font-medium text-sidebar-text transition-all duration-150 outline-none hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-cta/60"
				>
					<Activity
						class="h-5 w-5 shrink-0 text-sidebar-muted transition-colors duration-150 group-hover:text-white"
						aria-hidden="true"
					/>
					<span class="flex-1">Sentry</span>
					<ExternalLink class="h-3.5 w-3.5 shrink-0 text-sidebar-muted" aria-hidden="true" />
				</a>
			{/if}
		</div>
	</nav>

	<div class="relative border-t border-white/10 p-3">
		{#if accountOpen}
			<!-- Pop-up menu: opens upward from the trigger. Holds profile + Mode + Sign out. -->
			<div
				bind:this={menuEl}
				role="menu"
				aria-label="Account"
				class="absolute bottom-full left-3 right-3 z-10 mb-2 rounded-lg border border-white/10 bg-sidebar p-2 shadow-xl shadow-black/50"
			>
				{#if user}
					<div class="flex items-center gap-3 rounded-md px-2 py-2">
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
					<div class="my-1.5 h-px bg-white/10"></div>
				{/if}

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
			class="group flex min-h-[44px] w-full cursor-pointer items-center gap-3 rounded-md px-2 text-sm font-medium text-sidebar-text transition-all duration-150 outline-none hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-cta/60 {accountOpen
				? 'bg-white/5 text-white'
				: ''}"
		>
			<div
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cta text-xs font-semibold text-white"
				aria-hidden="true"
			>
				{initials}
			</div>
			<span class="min-w-0 flex-1 truncate text-left">{user?.name ?? 'Account'}</span>
			<ChevronsUpDown class="h-4 w-4 shrink-0 text-sidebar-muted" aria-hidden="true" />
		</button>
	</div>
</div>
