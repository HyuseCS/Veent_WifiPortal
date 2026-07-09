<script lang="ts">
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import RotateCw from 'lucide-svelte/icons/rotate-cw';
	import Lock from 'lucide-svelte/icons/lock';
	import SearchX from 'lucide-svelte/icons/search-x';
	import Timer from 'lucide-svelte/icons/timer';
	import ServerCrash from 'lucide-svelte/icons/server-crash';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';

	// In-shell error boundary: renders INSIDE the (app) layout, so a single page's load failure
	// shows a contained panel where the content would be — the sidebar + topbar stay put and the
	// operator can navigate elsewhere. (The root +error.svelte is the full-screen fallback for
	// failures that happen before/at the layout itself.) Copy mirrors the root page's vocabulary.
	type IconComp = typeof TriangleAlert;

	const COPY: Record<number, { title: string; body: string; icon: IconComp }> = {
		400: {
			title: 'Bad request',
			body: "That request wasn't formed correctly. Try again.",
			icon: TriangleAlert
		},
		401: {
			title: 'Sign in required',
			body: 'Your session has ended. Sign in to continue.',
			icon: Lock
		},
		403: {
			title: 'Not authorized',
			body: "You don't have permission to view this section.",
			icon: Lock
		},
		404: {
			title: 'Not found',
			body: "This page doesn't exist — it may have been moved or removed.",
			icon: SearchX
		},
		429: {
			title: 'Too many requests',
			body: "You've hit the rate limit. Wait a moment, then retry.",
			icon: Timer
		},
		503: {
			title: 'Service unavailable',
			body: "We couldn't load this section just now. Please try again shortly.",
			icon: ServerCrash
		}
	};

	const status = $derived(page.status);
	const fallback: { title: string; body: string; icon: IconComp } = $derived(
		status >= 500
			? {
					title: 'Something went wrong',
					body: "An error on our end stopped this section from loading. Try again.",
					icon: ServerCrash
				}
			: {
					title: "That didn't work",
					body: "We couldn't open this section. Try again, or head to another area.",
					icon: TriangleAlert
				}
	);
	const copy = $derived(COPY[status] ?? fallback);
	const Icon = $derived(copy.icon);

	// A load failure is usually transient — re-running the load is the natural retry. 401/403 are
	// not retryable, so send those to the login page instead.
	const authError = $derived(status === 401 || status === 403);

	// Return the operator to where they came from (e.g. the incident board after a bad /issues/[id]),
	// not a fixed dashboard. Falls back to the dashboard only on a cold/direct load with no history.
	function goBack() {
		if (typeof history !== 'undefined' && history.length > 1) history.back();
		else location.href = '/dashboard';
	}
</script>

<div class="grid h-full min-h-[60vh] place-items-center">
	<div class="w-full max-w-md rounded-2xl border border-border bg-bg p-8 text-center shadow-sm">
		<div class="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-brand/10 text-brand">
			<Icon class="h-7 w-7" aria-hidden="true" />
		</div>
		<p class="mt-5 font-mono text-xs font-semibold tracking-[0.2em] text-muted">ERROR {status}</p>
		<h1 class="mt-1 text-xl font-bold tracking-tight text-ink">{copy.title}</h1>
		<p class="mt-2 text-sm leading-relaxed text-muted">{copy.body}</p>

		{#if page.error?.message && page.error.message !== copy.title}
			<p class="mt-4 rounded-lg bg-surface px-3 py-2 font-mono text-xs break-words text-muted">
				{page.error.message}
			</p>
		{/if}

		<div class="mt-7 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
			{#if authError}
				<a
					href="/login"
					class="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
				>
					Sign in
				</a>
			{:else}
				<button
					type="button"
					onclick={() => invalidateAll()}
					class="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
				>
					<RotateCw class="h-4 w-4" aria-hidden="true" />
					Try again
				</button>
				<button
					type="button"
					onclick={goBack}
					class="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-lg border border-border bg-bg px-4 text-sm font-medium text-ink transition-colors hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
				>
					<ArrowLeft class="h-4 w-4" aria-hidden="true" />
					Go back
				</button>
			{/if}
		</div>
	</div>
</div>
