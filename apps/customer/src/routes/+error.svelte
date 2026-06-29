<script lang="ts">
	import { page } from '$app/state';
	import { fade } from 'svelte/transition';

	// Friendly, guest-facing copy per status. Anything unlisted falls back by class
	// (5xx = our fault, other 4xx = generic) so a new status code never shows a blank page.
	const COPY: Record<number, { title: string; body: string }> = {
		400: {
			title: 'Something looked off',
			body: "That request didn't come through correctly. Head back and try again."
		},
		401: {
			title: 'Please log in',
			body: 'You need to be signed in to see this. Log in with your phone number to continue.'
		},
		402: {
			title: 'Not enough credits',
			body: "You don't have enough credits for that yet. Top up and try again."
		},
		403: {
			title: 'Not available',
			body: "You don't have access to this page."
		},
		404: {
			title: "We can't find that",
			body: "The page you were after doesn't exist — it may have moved."
		},
		429: {
			title: 'Just a moment',
			body: "You've made a lot of requests in a short time. Wait a little, then try again."
		},
		503: {
			title: 'Briefly unavailable',
			body: "We couldn't complete that just now. Please try again in a moment."
		}
	};

	const status = $derived(page.status);
	const copy = $derived(
		COPY[status] ??
			(status >= 500
				? {
						title: 'Something went wrong',
						body: 'A problem on our end stopped that from loading. Please try again.'
					}
				: {
						title: "That didn't work",
						body: "We couldn't open that page. Head back to the portal and try again."
					})
	);
	// Auth-ish statuses send the guest to log in; everything else back to the portal start.
	const cta = $derived(
		status === 401 || status === 403
			? { href: '/login', label: 'Log in' }
			: { href: '/', label: 'Back to the portal' }
	);
</script>

<svelte:head>
	<title>{status} · Veent WiFi</title>
</svelte:head>

<main class="flex min-h-screen flex-col items-center justify-center bg-surface px-6 py-12">
	<div
		class="flex w-full max-w-sm flex-col items-center text-center"
		in:fade={{ duration: 200 }}
	>
		<p class="font-mono text-[64px] leading-none font-bold tracking-tight text-brand">
			{status}
		</p>
		<h1 class="mt-5 text-[22px] font-bold tracking-tight text-ink">{copy.title}</h1>
		<p class="mt-2 text-[15px] leading-relaxed text-muted">{copy.body}</p>

		<a
			href={cta.href}
			class="mt-8 flex h-[54px] w-full items-center justify-center rounded-xl bg-cta text-base font-bold text-white transition-colors hover:bg-cta-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta"
		>
			{cta.label}
		</a>
	</div>
</main>
