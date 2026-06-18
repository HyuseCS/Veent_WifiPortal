<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageServerData, ActionData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	// Credits-per-peso decides the honest "Best value" badge: bigger bundles give
	// a better rate, so the highest ratio wins it. No fake "most popular".
	function bestValueOf(bundles: PageServerData['bundles']): number | null {
		let best: { id: number; rate: number } | null = null;
		for (const b of bundles) {
			const rate = (b.creditsProvided ?? 0) / (b.fiatCost || Infinity);
			if (!best || rate > best.rate) best = { id: b.id, rate };
		}
		return best?.id ?? null;
	}

	const bestValueId = $derived(bestValueOf(data.bundles));

	// The user's explicit choice; null until they tap one. The effective selection
	// falls back to the best-value bundle so a one-tap path to payment always exists.
	let userPick = $state<number | null>(null);
	const selectedId = $derived(userPick ?? bestValueId);

	let pending = $state(false);

	// Selecting a bundle creates a Maya checkout server-side and 303-redirects to
	// the gateway (an external URL). enhance's default would `goto()` that, which
	// only handles internal nav — so we follow the external location ourselves and
	// keep the button in its pending state until the page unloads.
	const checkout: SubmitFunction = () => {
		pending = true;
		return async ({ result, update }) => {
			if (result.type === 'redirect') {
				window.location.href = result.location;
				return;
			}
			pending = false;
			await update();
		};
	};
</script>

<main class="mx-auto flex min-h-screen max-w-sm flex-col p-6">
	<header class="space-y-1">
		<h1 class="text-2xl font-bold tracking-tight text-ink">Top up credits</h1>
		<p class="text-sm text-muted">Add credits to your balance to keep browsing.</p>
	</header>

	<div class="rounded-xl p-6">
		<p class="text-sm font-medium opacity-75">Your balance</p>
		<p class="mt-1 font-mono text-4xl font-bold">{data.balance} credits</p>
	</div>

	{#if form?.error}
		<p class="rounded-lg bg-blocked/10 px-4 py-3 text-sm text-blocked" role="alert">{form.error}</p>
	{/if}

	{#if data.bundles.length === 0}
		<p class="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
			No credit bundles are available right now. Please check back soon.
		</p>
	{:else}
		<form method="post" action="?/checkout" use:enhance={checkout} class="space-y-4">
			<fieldset class="space-y-3">
				<legend class="mb-3 text-sm font-semibold text-ink">Choose an amount</legend>
				{#each data.bundles as bundle (bundle.id)}
					{@const selected = selectedId === bundle.id}
					<label
						class="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors duration-150 {selected
							? 'border-neutral-400 bg-neutral-100'
							: 'border-neutral-200 bg-bg hover:bg-neutral-50'}"
					>
						<input
							type="radio"
							name="packageId"
							value={bundle.id}
							checked={selected}
							onchange={() => (userPick = bundle.id)}
							class="sr-only"
						/>
						<span
							class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 {selected
								? 'border-neutral-700'
								: 'border-neutral-300'}"
							aria-hidden="true"
						>
							{#if selected}
								<span class="h-2.5 w-2.5 rounded-full bg-neutral-700"></span>
							{/if}
						</span>
						<span class="flex-1">
							<span class="block text-base font-semibold text-ink">₱{bundle.fiatCost}</span>
							<span class="block text-sm text-muted">{bundle.creditsProvided} credits</span>
						</span>
						{#if bundle.id === bestValueId}
							<span
								class="rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning"
							>
								Best value
							</span>
						{/if}
					</label>
				{/each}
			</fieldset>

			<button
				type="submit"
				disabled={pending || selectedId === null}
				class="flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-cta px-4 py-3 text-sm font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-cta-hover active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta disabled:cursor-not-allowed disabled:opacity-40"
			>
				{#if pending}
					<span
						class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
						aria-hidden="true"
					></span>
					<span class="sr-only">Redirecting to payment…</span>
				{:else}
					Continue to payment
				{/if}
			</button>

			<p class="text-center text-xs text-muted">Secured by Maya · credits are added after payment</p>
		</form>
	{/if}

	<a
		href="/dashboard"
		class="text-center text-sm font-medium text-muted transition-colors hover:text-ink pt-4"
	>
		Back to dashboard
	</a>
</main>
