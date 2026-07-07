<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { toasts } from '$lib/toasts.svelte';
	import Icon from '$lib/Icon.svelte';
	import { resetAccountLive } from '$lib/live.svelte';
	import type { AccountView } from '$lib/server/account-view';

	// This device has live account time but isn't bound (auto-bind hit the cap, or a router
	// hiccup). Surfaces a connect/replace prompt. The page decides when to render this.
	let { devices, mac }: { devices: AccountView['devices']; mac: string } = $props();

	let connecting = $state(false);
	const reconnect: SubmitFunction = () => {
		connecting = true;
		return async ({ result, update }) => {
			if (result.type === 'success') {
				location.reload(); // reload so connected state shows immediately (see the page's buy flow)
				return;
			}
			if (result.type === 'failure') toasts.show('Could not connect this device.', 'error');
			await update();
			resetAccountLive();
			connecting = false;
		};
	};
</script>

<section class="mb-4 rounded-2xl border border-warning/30 bg-warning/[0.12] p-[15px] lg:p-5">
	<div class="flex items-start gap-3">
		<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warning/20">
			<Icon name="alert-triangle" size={18} class="text-warning" />
		</div>
		<div class="min-w-0 flex-1">
			{#if devices.atCap}
				<div class="text-[14px] font-bold text-ink">Device limit reached</div>
				<div class="mb-3 text-[12.5px] text-muted">
					Your account is on {devices.cap} devices. Connect this one by replacing the device you've
					used least recently{devices.oldest?.macTail ? ` (··${devices.oldest.macTail})` : ''}.
				</div>
			{:else}
				<div class="text-[14px] font-bold text-ink">This device isn't connected</div>
				<div class="mb-3 text-[12.5px] text-muted">
					You have account time left — connect this device to get online.
				</div>
			{/if}
			<form
				method="post"
				action="?/bindThisDevice"
				use:enhance={reconnect}
				class="group"
				data-pending={connecting ? '' : null}
				data-pending-form
			>
				<input type="hidden" name="mac" value={mac} />
				<button
					disabled={connecting}
					class="flex h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white transition-colors hover:bg-brand-hover hover:cursor-pointer group-data-[pending]:pointer-events-none group-data-[pending]:opacity-70"
				>
					<span
						class="hidden h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white group-data-[pending]:inline-block"
						aria-hidden="true"
					></span>
					<span class="group-data-[pending]:hidden">
						<Icon name="refresh-cw" size={16} />
					</span>
					{devices.atCap ? 'Replace oldest device' : 'Connect this device'}
				</button>
			</form>
		</div>
	</div>
</section>
