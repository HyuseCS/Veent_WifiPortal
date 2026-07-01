<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Sentry from '@sentry/sveltekit';

	let clientMsg = $state('');

	// Uncaught client throw → captured by the browser SDK's global error handler / handleError.
	// NOTE: browser ad-blockers or Firefox tracking-protection may block the send (see server test).
	function throwClientError() {
		clientMsg = '';
		throw new Error('Sentry client test: intentional client-side error');
	}

	// Direct client capture — more reliable than an uncaught throw (no global-handler dependency),
	// but still needs the browser→Sentry request to get through (disable ad-block for localhost).
	function captureClientError() {
		Sentry.captureException(new Error('Sentry client test: captureException'));
		clientMsg = 'Called captureException — check Sentry → Issues (needs browser send to succeed).';
	}

	// Client-side slow span — proves browser performance tracing.
	async function clientSlowSpan() {
		clientMsg = 'running client span…';
		await Sentry.startSpan({ name: 'sentry-test.client-slow-op', op: 'test' }, async () => {
			await new Promise((r) => setTimeout(r, 1500));
		});
		clientMsg = 'Client span sent — check Sentry → Performance.';
	}
</script>

<svelte:head><title>Sentry Test (dev)</title></svelte:head>

<main class="mx-auto flex max-w-2xl flex-col gap-6 p-8">
	<header class="flex flex-col gap-1">
		<h1 class="text-2xl font-semibold tracking-tight">Sentry test — dev only</h1>
		<p class="text-sm text-muted-foreground">
			This route 404s in production. Click a button, then look in Sentry — <strong>Issues</strong>
			for errors, <strong>Performance</strong> for spans. Events are tagged <code>app=admin</code>.
		</p>
	</header>

	<section class="flex flex-col gap-3 rounded-lg border border-white/10 p-5">
		<h2 class="text-sm font-semibold tracking-wide uppercase">Server (definitive — bypasses browser)</h2>
		<p class="text-sm text-muted-foreground">
			Sent Node → Sentry directly, so ad-blockers / CORS / tracking-protection can't interfere.
		</p>
		<div class="flex flex-wrap gap-3">
			<form method="POST" action="?/serverError" use:enhance>
				<button
					type="submit"
					class="min-h-[44px] cursor-pointer rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-500"
				>
					Throw server error
				</button>
			</form>
			<form method="POST" action="?/serverSpan" use:enhance>
				<button
					type="submit"
					class="min-h-[44px] cursor-pointer rounded-md bg-white/10 px-4 text-sm font-medium hover:bg-white/15"
				>
					Fire server span (1.5s)
				</button>
			</form>
		</div>
	</section>

	<section class="flex flex-col gap-3 rounded-lg border border-white/10 p-5">
		<h2 class="text-sm font-semibold tracking-wide uppercase">Client (browser — may be ad-block blocked)</h2>
		<div class="flex flex-wrap gap-3">
			<button
				type="button"
				onclick={throwClientError}
				class="min-h-[44px] cursor-pointer rounded-md bg-red-600/80 px-4 text-sm font-medium text-white hover:bg-red-500"
			>
				Throw client error (uncaught)
			</button>
			<button
				type="button"
				onclick={captureClientError}
				class="min-h-[44px] cursor-pointer rounded-md bg-white/10 px-4 text-sm font-medium hover:bg-white/15"
			>
				captureException (direct)
			</button>
			<button
				type="button"
				onclick={clientSlowSpan}
				class="min-h-[44px] cursor-pointer rounded-md bg-white/10 px-4 text-sm font-medium hover:bg-white/15"
			>
				Fire client span (1.5s)
			</button>
		</div>
		{#if clientMsg}
			<p class="text-sm text-muted-foreground">{clientMsg}</p>
		{/if}
	</section>
</main>
