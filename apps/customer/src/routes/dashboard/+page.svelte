<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { toasts } from '$lib/toast.svelte';
	import type { PageServerData, ActionData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	// In dev there's no captive-portal redirect to supply the device MAC, so fall
	// back to a placeholder so the buttons are testable.
	const mac = $derived(data.mac ?? 'DEV:00:00:00:00:01');

	// Connection confirmations stay in-page: a toast announces success instead of
	// navigating away to a separate page.
	const startFreeTime: SubmitFunction = () => {
		const minutes = data.freeTime.durationMinutes;
		return async ({ result, update }) => {
			if (result.type === 'success') {
				toasts.show(`You're now connected. Enjoy your free ${minutes} minutes.`);
			}
			await update();
		};
	};

	const buyTier = (tier: PageServerData['tiers'][number]): SubmitFunction => {
		return () =>
			async ({ result, update }) => {
				if (result.type === 'success') {
					toasts.show(`You're now connected with ${tier.name}. Enjoy your ${tier.durationMinutes} minutes.`);
				}
				await update();
			};
	};
	const nextFree = $derived(
		data.freeTime.nextEligibleAt ? new Date(data.freeTime.nextEligibleAt).toLocaleTimeString() : null
	);
</script>

<main class="mx-auto flex min-h-screen max-w-sm flex-col gap-6 p-6">
	<header class="space-y-1">
		<h1 class="text-xl font-semibold text-gray-900">Hi, {data.user.name}</h1>
		<p class="text-sm text-gray-500">
			Balance: <span class="font-semibold text-gray-900">{data.balance} credits</span>
		</p>
	</header>

	{#if form?.error}
		<p class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{form.error}</p>
	{/if}

	{#if data.blocked}
		<p class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
			Your account is blocked. Please contact venue staff.
		</p>
	{:else}
		<section class="rounded-xl border border-gray-200 p-4">
			<h2 class="text-sm font-semibold text-gray-900">Free Time</h2>
			{#if data.freeTime.eligible}
				<p class="mt-1 text-sm text-gray-500">
					You're eligible for {data.freeTime.durationMinutes} minutes of free access.
				</p>
				<form method="post" action="?/startFreeTime" use:enhance={startFreeTime} class="mt-3">
					<input type="hidden" name="mac" value={mac} />
					<button
						class="min-h-[44px] w-full rounded-lg bg-cta font-semibold text-white transition hover:bg-cta-hover hover:cursor-pointer"
					>
						Start {data.freeTime.durationMinutes}-min Free Access
					</button>
				</form>
			{:else}
				<p class="mt-1 text-sm text-gray-500">
					Free time used. Next session{nextFree ? ` at ${nextFree}` : ''}.
				</p>
			{/if}
		</section>

		<section class="space-y-3">
			<h2 class="text-sm font-semibold text-gray-900">Buy access</h2>
			{#each data.tiers as tier (tier.id)}
				<form
					method="post"
					action="?/buyTier"
					use:enhance={buyTier(tier)}
					class="flex items-center justify-between rounded-xl border border-gray-200 p-4"
				>
					<input type="hidden" name="mac" value={mac} />
					<input type="hidden" name="packageId" value={tier.id} />
					<div>
						<p class="text-sm font-medium text-gray-900">{tier.name}</p>
						<p class="text-xs text-gray-500">{tier.creditCost} credits · {tier.durationMinutes} min</p>
					</div>
					<button
						class="min-h-[44px] rounded-lg bg-cta px-4 text-sm font-semibold text-white transition hover:cursor-pointer hover:bg-cta-hover"
					>
						Buy
					</button>
				</form>
			{:else}
				<p class="text-sm text-gray-500">No access tiers available.</p>
			{/each}
		</section>

		<section class="flex flex-row items-center gap-3">
			<a href="/top-up" class="text-center text-sm font-medium text-cta hover:text-cta-hover underline">
				Top up credits
			</a>
			<form method="post" action="?/signOut" use:enhance>
				<button class="text-decoration-none text-center text-sm font-medium text-cta hover:text-cta-hover underline hover:cursor-pointer">
					Sign out
				</button>
			</form>
		</section>
		
	{/if}
</main>
