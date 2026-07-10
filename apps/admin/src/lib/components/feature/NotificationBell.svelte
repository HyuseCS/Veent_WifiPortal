<script lang="ts">
	import Bell from 'lucide-svelte/icons/bell';
	import Check from 'lucide-svelte/icons/check';
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { NotificationRow } from '$lib/server/notifications';
	import NotificationModal from './NotificationModal.svelte';

	/**
	 * Incident notification bell — rendered on every /issues* route (in the Topbar actions slot).
	 * Reads the shared load data (unread list + global unread count), shows a dropdown of recent
	 * activity on the user's incidents, with per-entry + bulk mark-read (?/markOne, ?/markAllRead)
	 * and a link to the full history. Mirrors the sidebar account menu's a11y (outside-click + Esc
	 * close, focus moves into the panel).
	 */
	const notifications = $derived((page.data.notifications ?? []) as NotificationRow[]);
	const unread = $derived((page.data.issuesUnread as number | undefined) ?? 0);
	const badgeLabel = $derived(unread > 99 ? '99+' : String(unread));

	let open = $state(false);
	let triggerEl = $state<HTMLButtonElement>();
	let panelEl = $state<HTMLDivElement>();

	// Clicking a notification opens a preview modal instead of navigating — so an incident the user
	// can no longer reach (unassigned + since reassigned/resolved) shows a graceful summary here,
	// not a full-page 404. The modal re-checks access server-side; this only decides how to present it.
	let modalOpen = $state(false);
	let selected = $state<NotificationRow | null>(null);

	// Opening a notification's preview counts as reading it: when the user closes the modal, mark that
	// event read (POST /issues?/markOne — idempotent, user+event scoped) and invalidate so the badge
	// count + list refresh. Best-effort: a failed mark just leaves it unread; the per-row check button
	// still works.
	async function markRead(eventId: number) {
		const body = new FormData();
		body.set('eventId', String(eventId));
		try {
			await fetch('/issues?/markOne', {
				method: 'POST',
				body,
				headers: { 'x-sveltekit-action': 'true' }
			});
			await invalidateAll();
		} catch {
			// swallow — read-marking is best-effort and self-heals on the next open/refresh.
		}
	}

	// Fire when the modal transitions closed with a notification still selected (i.e. the user opened
	// a preview and left it). Clearing `selected` first prevents a re-fire.
	$effect(() => {
		if (!modalOpen && selected) {
			const id = selected.id;
			selected = null;
			void markRead(id);
		}
	});

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
		<!-- `fixed` (not absolute): the Topbar sits inside the layout's overflow-hidden scroll column,
		     which would clip an absolutely-positioned panel. Anchored just below the h-16 top bar,
		     right-aligned to its padding, with a high z so it overlays the page content. -->
		<!-- A labelled region + plain list, not a role="menu": the panel holds forms/links/buttons, not
		     menuitems, so the ARIA menu interaction model (arrow-key roving, one focusable child) never
		     applied and misled screen readers (L6a). -->
		<div
			bind:this={panelEl}
			role="region"
			aria-label="Notifications"
			class="fixed top-[4.25rem] right-4 z-[60] w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-bg shadow-xl shadow-black/10 sm:right-6"
		>
			<div class="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
				<span class="text-sm font-semibold text-ink">Notifications</span>
				{#if notifications.length > 0}
					<form method="post" action="/issues?/markAllRead" use:enhance={() => async ({ update }) => {
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
				<ul class="max-h-80 overflow-y-auto py-1">
					{#each notifications as n (n.id)}
						<li class="flex items-start gap-1 transition-colors hover:bg-surface">
							<button
								type="button"
								onclick={() => {
									selected = n;
									modalOpen = true;
									open = false;
								}}
								class="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2 text-left outline-none focus-visible:bg-surface"
							>
								<span class="truncate text-sm font-medium text-ink">{n.issueTitle}</span>
								<span class="truncate text-xs text-muted">{n.summary}</span>
								<span class="text-[11px] text-muted">{relTime(n.createdAt)}</span>
							</button>
							<!-- Mark THIS one done (doesn't close the dropdown, so several can be cleared). -->
							<form
								method="post"
								action="/issues?/markOne"
								class="shrink-0 p-1.5"
								use:enhance={() => async ({ update }) => {
									await update();
								}}
							>
								<input type="hidden" name="eventId" value={n.id} />
								<button
									type="submit"
									aria-label="Mark this notification as read"
									title="Mark as read"
									class="flex h-8 w-8 items-center justify-center rounded-md text-muted outline-none transition-colors hover:bg-bg hover:text-brand focus-visible:ring-2 focus-visible:ring-brand/40"
								>
									<Check class="h-4 w-4" aria-hidden="true" />
								</button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}

			<a
				href={resolve('/issues/notifications')}
				onclick={() => (open = false)}
				class="block border-t border-border px-3 py-2.5 text-center text-xs font-medium text-brand outline-none transition-colors hover:bg-surface focus-visible:bg-surface"
			>
				View all notifications
			</a>
		</div>
	{/if}
</div>

<NotificationModal bind:open={modalOpen} notification={selected} />
