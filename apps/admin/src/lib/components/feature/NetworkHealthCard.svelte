<script lang="ts">
	import { enhance } from '$app/forms';
	import Wifi from 'lucide-svelte/icons/wifi';
	import MapPin from 'lucide-svelte/icons/map-pin';
	import Pencil from 'lucide-svelte/icons/pencil';
	import type { NetworkAp } from '$lib/types';
	import { Button, Field, StatusBadge } from '$lib/components/ui';
	import MapPicker from './MapPicker.svelte';

	// `selected` rings the card and mirrors the coverage-map focus; clicking the card
	// (or its onfocus) selects this AP on the page-level map.
	let {
		ap,
		selected = false,
		onfocus
	}: { ap: NetworkAp; selected?: boolean; onfocus?: (id: string) => void } = $props();

	// tone → token classes for the status icon tile + accents.
	const toneIcon: Record<string, string> = {
		online: 'bg-online/10 text-online',
		warning: 'bg-warning/10 text-warning',
		blocked: 'bg-blocked/10 text-blocked'
	};
	const toneBar: Record<string, string> = {
		online: 'bg-online',
		warning: 'bg-warning',
		blocked: 'bg-blocked'
	};

	// Pull the leading number out of a pre-formatted metric string ("47 Mbps", "22ms").
	const num = (s: string): number => {
		const n = parseFloat(s);
		return Number.isFinite(n) ? n : NaN;
	};

	// Uplink load as a share of a 120 Mbps reference, for the bar + caption.
	const loadPct = $derived.by(() => {
		const t = num(ap.throughput);
		return Number.isFinite(t) ? Math.min(100, Math.round((t / 120) * 100)) : 0;
	});

	// Latency colour bands, independent of overall status.
	const latColor = $derived.by(() => {
		const l = num(ap.latency);
		if (!Number.isFinite(l)) return 'text-muted';
		if (l < 20) return 'text-online';
		if (l < 40) return 'text-warning';
		return 'text-blocked';
	});

	const metrics = $derived([
		{ label: 'Uptime', value: ap.uptime, class: 'text-ink' },
		{ label: 'Latency', value: ap.latency, class: latColor },
		{ label: 'Users', value: String(ap.users), class: 'text-ink' },
		{ label: 'Tput', value: ap.throughput, class: 'text-ink' }
	]);

	const placed = $derived(ap.latitude != null && ap.longitude != null);
	const coordText = $derived(
		placed ? `${Number(ap.latitude).toFixed(4)}, ${Number(ap.longitude).toFixed(4)}` : 'Not placed on map'
	);

	// A placed AP shows its coords + "Edit"; editing reveals the form.
	let editing = $state(false);

	// Edits (typed or map-picked) override the saved value; null = show the saved
	// coord. Cleared on a successful save so the field re-syncs to the fresh `ap`.
	let editLat = $state<string | null>(null);
	let editLng = $state<string | null>(null);
	const latitude = $derived(editLat ?? ap.latitude ?? '');
	const longitude = $derived(editLng ?? ap.longitude ?? '');

	const toNum = (s: string): number | null => {
		const n = Number(s);
		return s.trim() !== '' && Number.isFinite(n) ? n : null;
	};

	function cancelEdit() {
		editing = false;
		editLat = null;
		editLng = null;
		msg = null;
	}

	let saving = $state(false);
	let msg = $state<{ ok: boolean; text: string } | null>(null);
</script>

<div
	role="button"
	tabindex="0"
	onclick={(e) => {
		// Clicks inside the open location form shouldn't re-focus the map.
		if ((e.target as HTMLElement).closest('form')) return;
		onfocus?.(ap.id);
	}}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onfocus?.(ap.id);
		}
	}}
	class="flex cursor-pointer flex-col gap-4 rounded-xl border bg-bg p-4.5 shadow-sm transition-[border-color,box-shadow] duration-150 hover:border-brand/60 hover:shadow-md {selected
		? 'border-[1.5px] border-brand'
		: 'border-border'}"
>
	<div class="flex items-center justify-between gap-2">
		<div class="flex min-w-0 items-center gap-3">
			<span
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg {toneIcon[ap.tone]}"
				aria-hidden="true"
			>
				<Wifi class="h-4.5 w-4.5" />
			</span>
			<div class="min-w-0">
				<div class="truncate text-sm font-semibold text-ink">{ap.name}</div>
				{#if ap.address}
					<div class="truncate text-xs text-muted">{ap.address}</div>
				{/if}
			</div>
		</div>
		<StatusBadge tone={ap.tone} label={ap.status} pulse={ap.tone !== 'online'} />
	</div>

	<dl class="grid grid-cols-4 gap-2 border-y border-border py-3 text-center">
		{#each metrics as metric (metric.label)}
			<div class="flex flex-col gap-1">
				<dt class="text-[10px] font-bold tracking-wide text-muted uppercase">{metric.label}</dt>
				<dd class="font-mono text-sm font-semibold {metric.class}">{metric.value}</dd>
			</div>
		{/each}
	</dl>

	<div class="flex flex-col gap-1.5">
		<div class="flex items-center justify-between">
			<span class="text-xs font-medium text-muted">Uplink load</span>
			<span class="font-mono text-xs font-medium text-muted">{loadPct}%</span>
		</div>
		<div class="h-1.5 overflow-hidden rounded bg-surface">
			<div class="h-full rounded {toneBar[ap.tone]}" style="width: {loadPct}%"></div>
		</div>
	</div>

	<div class="flex items-center justify-between gap-2">
		<span class="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted">
			<MapPin
				class="h-3.5 w-3.5 shrink-0 {placed ? 'text-brand' : 'text-muted'}"
				aria-hidden="true"
			/>
			<span class="truncate">{coordText}</span>
		</span>
		<!-- Reveals the location form; stops the card's focus click. -->
		<button
			type="button"
			onclick={(e) => {
				e.stopPropagation();
				editing = !editing;
			}}
			class="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-muted transition-colors duration-150 hover:border-brand/40 hover:text-ink"
		>
			<Pencil class="h-3.5 w-3.5" aria-hidden="true" />
			Edit
		</button>
	</div>

	{#if editing}
		<!-- Click/drag the map or type to set this AP's location. Same setLocation action.
		     Card-focus is suppressed for clicks inside this form (see the card's onclick). -->
		<form
			method="POST"
			action="?/setLocation"
			class="space-y-3 border-t border-border pt-3"
			use:enhance={() => {
				saving = true;
				msg = null;
				return async ({ result, update }) => {
					saving = false;
					if (result.type === 'success') {
						msg = { ok: true, text: 'Saved.' };
						editLat = null;
						editLng = null;
						editing = false; // back to the coords view
					} else if (result.type === 'failure') {
						msg = { ok: false, text: String(result.data?.error ?? 'Could not save.') };
					}
					await update({ reset: false });
				};
			}}
		>
			<input type="hidden" name="id" value={ap.id} />

			<MapPicker
				height="h-40"
				autolocate={false}
				lat={toNum(latitude)}
				lng={toNum(longitude)}
				onpick={(c) => {
					editLat = String(c.lat);
					editLng = String(c.lng);
				}}
			/>

			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-1.5">
					<label for="lat-{ap.id}" class="block text-sm font-medium text-ink">Latitude</label>
					<input
						id="lat-{ap.id}"
						name="latitude"
						value={latitude}
						oninput={(e) => (editLat = e.currentTarget.value)}
						inputmode="decimal"
						placeholder="14.5560"
						class="min-h-[44px] w-full rounded-lg border border-border bg-bg px-4 py-3 text-sm text-ink transition-[border-color,box-shadow] duration-150 hover:border-brand/40 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
					/>
				</div>
				<div class="space-y-1.5">
					<label for="lng-{ap.id}" class="block text-sm font-medium text-ink">Longitude</label>
					<input
						id="lng-{ap.id}"
						name="longitude"
						value={longitude}
						oninput={(e) => (editLng = e.currentTarget.value)}
						inputmode="decimal"
						placeholder="121.0244"
						class="min-h-[44px] w-full rounded-lg border border-border bg-bg px-4 py-3 text-sm text-ink transition-[border-color,box-shadow] duration-150 hover:border-brand/40 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
					/>
				</div>
			</div>
			<Field
				id="addr-{ap.id}"
				name="address"
				label="Address"
				type="text"
				placeholder="Venue, City"
				value={ap.address ?? ''}
			/>
			<div class="flex items-center gap-3">
				<Button type="submit" loading={saving}>Save location</Button>
				<Button type="button" variant="secondary" onclick={cancelEdit}>Cancel</Button>
				{#if msg}
					<span
						class="animate-fade-in text-xs"
						style="color: {msg.ok ? 'var(--color-online)' : 'var(--color-blocked)'}"
					>
						{msg.text}
					</span>
				{/if}
			</div>
		</form>
	{/if}
</div>
