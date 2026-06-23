<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { Button, Field } from '$lib/components/ui';
	import MapPicker from './MapPicker.svelte';

	// Parent (the AP sidebar's + button) toggles this; two-way so we can self-close.
	let { open = $bindable(false) }: { open?: boolean } = $props();

	let dialogEl = $state<HTMLDialogElement>();

	let name = $state('');
	let address = $state('');
	let lat = $state<number | null>(null);
	let lng = $state<number | null>(null);
	let error = $state('');
	let submitting = $state(false);

	// Keep the native <dialog> in step with `open`.
	$effect(() => {
		if (open) dialogEl?.showModal();
		else dialogEl?.close();
	});

	function close() {
		open = false;
		name = '';
		address = '';
		lat = null;
		lng = null;
		error = '';
		submitting = false;
	}
</script>

<dialog
	bind:this={dialogEl}
	onclose={close}
	class="m-auto w-full max-w-lg rounded-lg border border-border bg-bg p-6 text-ink backdrop:bg-black/50"
>
	<h2 class="text-lg font-semibold text-ink">Add a router location</h2>
	<p class="mt-1 text-sm text-muted">Click the map to drop a pin, then name the spot.</p>

	<form
		method="post"
		action="?/addPlace"
		use:enhance={() => {
			submitting = true;
			return async ({ result, update }) => {
				submitting = false;
				if (result.type === 'success') {
					await invalidateAll();
					close();
				} else if (result.type === 'failure') {
					error = String(result.data?.error ?? 'Could not add the location.');
				}
				await update({ reset: false });
			};
		}}
		class="mt-4 space-y-3"
	>
		<!-- Mounted only while open so leaflet measures a laid-out container. -->
		{#if open}
			<MapPicker bind:lat bind:lng />
		{/if}

		<p class="font-mono text-xs text-muted">
			{lat != null && lng != null
				? `${lat.toFixed(6)}, ${lng.toFixed(6)}`
				: 'No location picked yet'}
		</p>

		<Field
			id="place-name"
			label="Name"
			name="name"
			placeholder="e.g. Lobby AP"
			value={name}
			oninput={(e) => (name = e.currentTarget.value)}
		/>
		<Field
			id="place-address"
			label="Address (optional)"
			name="address"
			placeholder="Street, building, floor…"
			value={address}
			oninput={(e) => (address = e.currentTarget.value)}
		/>

		<input type="hidden" name="latitude" value={lat ?? ''} />
		<input type="hidden" name="longitude" value={lng ?? ''} />

		{#if error}<p class="text-sm text-blocked">{error}</p>{/if}

		<div class="flex justify-end gap-2">
			<Button type="button" variant="secondary" onclick={close}>Cancel</Button>
			<Button type="submit" disabled={submitting || !name.trim() || lat == null}>
				Add location
			</Button>
		</div>
	</form>
</dialog>
