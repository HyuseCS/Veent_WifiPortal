<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { toasts } from '$lib/toasts.svelte';
	import Icon from '$lib/Icon.svelte';

	type Device = {
		id: number;
		macTail: string | null;
		thisDevice: boolean;
		boundAt: string;
		lastSeenAt: string;
	};
	type Devices = {
		cap: number;
		count: number;
		thisDeviceBound: boolean;
		atCap: boolean;
		oldest: { id: number; macTail: string | null } | null;
		list: Device[];
	};

	let { devices }: { devices: Devices } = $props();

	function ago(iso: string): string {
		const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
		if (m < 1) return 'just now';
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ago`;
		return `${Math.floor(h / 24)}d ago`;
	}

	const onRemove: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'success') toasts.show('Device removed.');
			await update();
		};
	};
	const onRemoveAll: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'success') toasts.show('All devices disconnected.');
			await update();
		};
	};
</script>

<section class="mt-4 rounded-2xl border border-border bg-surface p-[17px] lg:p-6">
	<div class="mb-1 flex items-center justify-between">
		<h2 class="text-[15px] font-bold text-ink">Your devices</h2>
		<span class="font-mono text-xs text-muted">{devices.count} of {devices.cap} devices</span>
	</div>
	<p class="mb-1 text-xs text-muted">Your account time is shared across these devices.</p>

	<div>
		{#each devices.list as d (d.id)}
			<div
				class="flex min-h-[44px] items-center justify-between gap-3 border-t border-border py-3 first:border-t-0"
			>
				<div class="flex items-center gap-3">
					<div
						class="flex h-9 w-9 items-center justify-center rounded-xl {d.thisDevice
							? 'bg-brand text-white'
							: 'bg-bg text-muted'}"
					>
						<Icon name="smartphone" size={17} />
					</div>
					<div>
						<div class="flex items-center gap-2">
							<span class="text-[14px] font-semibold text-ink">
								{d.thisDevice ? 'This device' : 'Device'}
							</span>
							{#if d.thisDevice}
								<span class="flex items-center gap-1">
									<span class="h-1.5 w-1.5 rounded-full bg-online"></span>
									<span class="text-[11px] font-semibold text-online">Online now</span>
								</span>
							{/if}
						</div>
						<div class="font-mono text-[11.5px] text-muted">
							··{d.macTail ?? '—'} · {d.thisDevice ? 'connected' : `seen ${ago(d.lastSeenAt)}`}
						</div>
					</div>
				</div>
				<form method="post" action="?/unbindDevice" use:enhance={onRemove}>
					<input type="hidden" name="deviceId" value={d.id} />
					<button
						aria-label={d.thisDevice ? 'Disconnect this device' : `Remove device ··${d.macTail}`}
						title={d.thisDevice ? 'Disconnect this device' : `Remove device ··${d.macTail}`}
						class="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-blocked/10 hover:text-blocked hover:cursor-pointer"
					>
						<Icon name="trash" size={16} />
					</button>
				</form>
			</div>
		{/each}
	</div>

	<div class="mt-3 flex items-center justify-between border-t border-border pt-3">
		<a
			href={resolve('/faq')}
			class="text-[12px] font-medium text-muted underline-offset-2 hover:underline"
		>
			Why do I see extra devices?
		</a>
		{#if devices.count > 0}
			<form method="post" action="?/unbindAll" use:enhance={onRemoveAll}>
				<button
					class="flex min-h-[36px] items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-semibold text-muted transition-colors hover:text-blocked hover:cursor-pointer"
				>
					<Icon name="x" size={14} />
					Disconnect all
				</button>
			</form>
		{/if}
	</div>
</section>
