<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Icon from '$lib/Icon.svelte';
	import { resetAccountLive } from '$lib/live.svelte';

	// Free Time available — one session for the whole account, once per cooldown window.
	let {
		durationMinutes,
		mac,
		hasMac
	}: {
		durationMinutes: number;
		mac: string;
		hasMac: boolean;
	} = $props();

	let startingFree = $state(false);
	const startFreeTime: SubmitFunction = () => {
		startingFree = true;
		return async ({ result, update }) => {
			if (result.type === 'success') {
				location.reload(); // reload so connected state shows immediately (see the page's buy flow)
				return;
			}
			await update();
			resetAccountLive();
			startingFree = false;
		};
	};
</script>

<section class="mb-6 rounded-2xl border border-brand/20 bg-brand-tint-2 p-[17px] lg:mb-0 lg:p-7">
	<div class="mb-3.5 flex items-center gap-3 lg:gap-3.5">
		<div
			class="flex h-10 w-10 items-center justify-center rounded-xl bg-brand lg:h-[52px] lg:w-[52px] lg:rounded-2xl"
		>
			<Icon name="clock" size={21} class="text-white" />
		</div>
		<div>
			<div class="text-[15px] font-bold text-ink lg:text-[19px]">Free Time available</div>
			<div class="text-xs font-medium text-brand lg:text-[13.5px]">
				{durationMinutes} minutes for your whole account · once per 12 hours
			</div>
		</div>
	</div>
	<form
		method="post"
		action="?/startFreeTime"
		use:enhance={startFreeTime}
		class="group"
		data-pending={startingFree ? '' : null}
		data-pending-form
	>
		<input type="hidden" name="mac" value={mac} />
		<button
			disabled={!hasMac || startingFree}
			class="flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-cta text-[15px] font-bold text-white transition-colors hover:bg-cta-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta hover:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 lg:h-14 lg:text-base group-data-[pending]:pointer-events-none group-data-[pending]:opacity-70"
		>
			<span
				class="hidden h-[18px] w-[18px] animate-spin rounded-full border-[2.5px] border-white/40 border-t-white group-data-[pending]:inline-block"
				aria-hidden="true"
			></span>
			Start {durationMinutes}-min Free Access
		</button>
	</form>
</section>
