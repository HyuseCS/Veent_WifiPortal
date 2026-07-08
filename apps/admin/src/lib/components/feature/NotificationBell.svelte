<script lang="ts">
	import Bell from 'lucide-svelte/icons/bell';
	import Check from 'lucide-svelte/icons/check';
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import type { NotificationRow } from '$lib/server/notifications';

	/**
	 * Incident notification bell — rendered only on /issues (in the Topbar actions slot). Reads the
	 * page's own load data (notifications list + global unread count), shows a dropdown of recent
	 * activity on incidents assigned to the user, and clears them via the ?/markRead action. Mirrors
	 * the sidebar account menu's a11y (outside-click + Esc close, focus moves into the panel).
	 */
	const notifications = $derived((page.data.notifications ?? []) as NotificationRow[]);
	const unread = $derived((page.data.issuesUnread as number | undefined) ?? 0);
	const badgeLabel = $derived(unread > 99 ? '99+' : String(unread));

	let open = $state(false);
	let triggerEl = $state<HTMLButtonElement>();
	let panelEl = $state<HTMLDivElement>();

	function close() {
		open = false;
		triggerEl?.focus();
	}

	// Close on outside click while open.
	$effect(() => {
		if (!open) return;
		const onDown = (e: PointerEvent) => {
			const t = e.target as Node;
			if (!panelEl?.contains(t) && !triggerEl?.contains(t)) open = false;
		};
		document.addEventListener('pointerdown', onDown, true);
		return () => document.removeEventListener('pointerdown', onDown, true);
	});

	// On open, move focus into the panel's first control.
	$effect(() => {
		if (open && panelEl) panelEl.querySelector<HTMLElement>('button, [href]')?.focus();
	});

	// Compact relative time — no dep (Intl.RelativeTimeFormat), same idea as the Timeline.
	const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
	function relTime(ms: number): string {
		const diff = ms - Date.now();
		const abs = Math.abs(diff);
		const min = 60_000,
			hr = 3_600_000,
			day = 86_400_000;
		if (abs < min) return 'just now';
		if (abs < hr) return rtf.format(Math.round(diff / min), 'minute');
		if (abs < day) return rtf.format(Math.round(diff / hr), 'hour');
		if (abs < day * 30) return rtf.format(Math.round(diff / day), 'day');
		return new Date(ms).toLocaleDateString();
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && open) {
			e.preventDefault();
			close();
		}
	}}
/>

<div class="relative">
	<button
		bind:this={triggerEl}
		type="button"
		onclick={() => (open = !open)}
		aria-haspopup="menu"
		aria-expanded={open}
		aria-label="Notifications{unread > 0 ? ` (${unread} unread)` : ''}"
		class="relative flex h-11 w-11 cursor-pointer items-center justify-center rounded-md border border-border bg-bg text-muted outline-none transition-[background-color,color,border-color] duration-150 hover:border-brand/40 hover:bg-surface hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/40"
	>
		<Bell class="h-4 w-4" aria-hidden="true" />
		{#if unread > 0}
			<span
				class="absolute -top-1 -right-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-brand px-1 py-0.5 text-[10px] leading-none font-semibold text-white"
				aria-hidden="true"
			>
				{badgeLabel}
			</span>
		{/if}
	</button>

	{#if open}
		<div
			bind:this={panelEl}
			role="menu"
			aria-label="Notifications"
			class="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-bg shadow-xl shadow-black/10"
		>
			<div class="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
				<span class="text-sm font-semibold text-ink">Notifications</span>
				{#if notifications.length > 0}
					<form method="post" action="/issues?/markRead" use:enhance={() => async ({ update }) => {
						open = false;
						await update(); // invalidates → sidebar badge + list refresh
					}}>
						<button
							type="submit"
							class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand outline-none transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-brand/40"
						>
							<Check class="h-3.5 w-3.5" aria-hidden="true" />
							Mark all read
						</button>
					</form>
				{/if}
			</div>

			{#if notifications.length === 0}
				<p class="px-3 py-6 text-center text-sm text-muted">You're all caught up.</p>
			{:else}
				<ul class="max-h-80 overflow-y-auto py-1" aria-live="polite">
					{#each notifications as n (n.id)}
						<li>
							<a
								href="/issues/{n.issueId}"
								role="menuitem"
								onclick={() => (open = false)}
								class="flex flex-col gap-0.5 px-3 py-2 outline-none transition-colors hover:bg-surface focus-visible:bg-surface"
							>
								<span class="truncate text-sm font-medium text-ink">{n.issueTitle}</span>
								<span class="truncate text-xs text-muted">{n.summary}</span>
								<span class="text-[11px] text-muted">{relTime(n.createdAt)}</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>
