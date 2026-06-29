<script lang="ts">
	import { page } from '$app/state';
	import { fade } from 'svelte/transition';
	import Lock from 'lucide-svelte/icons/lock';
	import SearchX from 'lucide-svelte/icons/search-x';
	import Timer from 'lucide-svelte/icons/timer';
	import ServerCrash from 'lucide-svelte/icons/server-crash';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';

	// All lucide-svelte icons share this component type.
	type IconComp = typeof TriangleAlert;

	// Operator-facing copy + icon per status. Unlisted codes fall back by class (5xx = server,
	// other 4xx = generic) so a new status never renders blank.
	const COPY: Record<number, { title: string; body: string; icon: IconComp }> = {
		400: {
			title: 'Bad request',
			body: "That request wasn't formed correctly. Go back and try again.",
			icon: TriangleAlert
		},
		401: {
			title: 'Sign in required',
			body: 'Your session has ended or you’re not signed in. Sign in to continue.',
			icon: Lock
		},
		403: {
			title: 'Not authorized',
			body: "You don't have permission to view this. An owner-only area needs owner access.",
			icon: Lock
		},
		404: {
			title: 'Page not found',
			body: "This page doesn't exist — it may have been moved or removed.",
			icon: SearchX
		},
		429: {
			title: 'Too many requests',
			body: "You've hit the rate limit for this action. Wait a moment, then retry.",
			icon: Timer
		},
		503: {
			title: 'Service unavailable',
			body: "We couldn't complete that just now. Please try again shortly.",
			icon: ServerCrash
		}
	};

	const status = $derived(page.status);
	const fallback: { title: string; body: string; icon: IconComp } = $derived(
		status >= 500
			? {
					title: 'Something went wrong',
					body: 'An error on our end stopped that from loading. Please try again.',
					icon: ServerCrash
				}
			: {
					title: "That didn't work",
					body: "We couldn't open this page. Head back to the dashboard and try again.",
					icon: TriangleAlert
				}
	);
	const copy = $derived(COPY[status] ?? fallback);
	const Icon = $derived(copy.icon);
	const cta = $derived(
		status === 401 || status === 403
			? { href: '/login', label: 'Sign in' }
			: { href: '/dashboard', label: 'Back to dashboard' }
	);
</script>

<svelte:head>
	<title>{status} · RADIUS Admin</title>
</svelte:head>

<main class="flex min-h-screen flex-col items-center justify-center bg-canvas px-6 py-12">
	<div
		class="w-full max-w-md rounded-2xl border border-border bg-bg p-8 text-center shadow-sm sm:p-10"
		in:fade={{ duration: 200 }}
	>
		<div class="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-brand/10 text-brand">
			<Icon class="h-7 w-7" aria-hidden="true" />
		</div>
		<p class="mt-5 font-mono text-xs font-semibold tracking-[0.2em] text-muted">ERROR {status}</p>
		<h1 class="mt-1 text-2xl font-bold tracking-tight text-ink">{copy.title}</h1>
		<p class="mt-2 text-sm leading-relaxed text-muted">{copy.body}</p>

		{#if page.error?.message && page.error.message !== copy.title}
			<p class="mt-4 rounded-lg bg-surface px-3 py-2 font-mono text-xs break-words text-muted">
				{page.error.message}
			</p>
		{/if}

		<a
			href={cta.href}
			class="mt-7 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
		>
			{cta.label}
		</a>
	</div>
</main>
