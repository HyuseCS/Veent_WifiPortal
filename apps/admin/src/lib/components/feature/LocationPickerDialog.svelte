<script lang="ts">
	import { Button } from '$lib/components/ui';
	import MapPicker from './MapPicker.svelte';

	// A popup map for picking one coordinate. Seeded with the caller's current
	// location (if any); `onconfirm` hands the chosen pair back. Used by the
	// Networks cards to fill their lat/lng without typing.
	let {
		open = $bindable(false),
		title = 'Pick location',
		initialLat = null,
		initialLng = null,
		onconfirm
	}: {
		open?: boolean;
		title?: string;
		initialLat?: number | null;
		initialLng?: number | null;
		onconfirm: (coords: { lat: number; lng: number }) => void;
	} = $props();

	let dialogEl = $state<HTMLDialogElement>();
	let lat = $state<number | null>(null);
	let lng = $state<number | null>(null);

	// Seed the working pin from the caller's current spot on each open.
	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen) {
			lat = initialLat;
			lng = initialLng;
			dialogEl?.showModal();
		} else if (!open && wasOpen) {
			dialogEl?.close();
		}
		wasOpen = open;
	});

	function confirm() {
		if (lat == null || lng == null) return;
		onconfirm({ lat, lng });
		open = false;
	}
</script>

<dialog
	bind:this={dialogEl}
	onclose={() => (open = false)}
	class="m-auto w-full max-w-lg rounded-lg border border-border bg-bg p-6 text-ink backdrop:bg-black/50"
>
	<h2 class="text-lg font-semibold text-ink">{title}</h2>
	<p class="mt-1 text-sm text-muted">Click the map to drop a pin; drag to fine-tune.</p>

	<div class="mt-4 space-y-3">
		{#if open}
			<MapPicker bind:lat bind:lng />
		{/if}

		<p class="font-mono text-xs text-muted">
			{lat != null && lng != null
				? `${lat.toFixed(6)}, ${lng.toFixed(6)}`
				: 'No location picked yet'}
		</p>

		<div class="flex justify-end gap-2">
			<Button type="button" variant="secondary" onclick={() => (open = false)}>Cancel</Button>
			<Button type="button" onclick={confirm} disabled={lat == null || lng == null}>
				Use this location
			</Button>
		</div>
	</div>
</dialog>
