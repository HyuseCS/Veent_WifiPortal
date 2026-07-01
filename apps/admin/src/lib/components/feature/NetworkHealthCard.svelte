<script lang="ts">
	import Wifi from 'lucide-svelte/icons/wifi';
	import MapPin from 'lucide-svelte/icons/map-pin';
	import Pencil from 'lucide-svelte/icons/pencil';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import Gauge from 'lucide-svelte/icons/gauge';
	import { onDestroy } from 'svelte';
	import { enhance } from '$app/forms';
	import type { NetworkAp } from '$lib/types';
	import { StatusBadge } from '$lib/components/ui';
	import { editLock } from '$lib/edit-lock.svelte';

	// `selected` rings the card and mirrors the coverage-map focus; clicking the card
	// (or its onfocus) selects this AP on the page-level map. Location editing happens on
	// the unified /map page (the "Edit on map" link deep-links to this AP's editor).
	let {
		ap,
		selected = false,
		canDelete = false,
		canConfigure = false,
		onfocus
	}: {
		ap: NetworkAp;
		selected?: boolean;
		/** Owner-only: show the delete control (the server re-checks owner regardless). */
		canDelete?: boolean;
		/** Owner-only: show the router config (interface binding + bandwidth caps) editor. */
		canConfigure?: boolean;
		onfocus?: (id: string) => void;
	} = $props();

	// Kbps (stored) → Mbps (shown/edited). Blank when uncapped so the field reads "no limit".
	const kbpsToMbps = (kbps: number | null): string => (kbps == null ? '' : String(kbps / 1000));

	// Save state for the router-config form, kept local so each card shows its own feedback
	// without threading page-level `form` data and matching ids.
	let savingConfig = $state(false);
	let configFeedback = $state<{ tone: 'ok' | 'error'; msg: string } | null>(null);

	// Hold the shared edit-lock while the config panel is open, so the page drops scroll-snap
	// and pauses live data swaps — otherwise a snap re-align or SSE frame yanks/resets the edit.
	let releaseLock: (() => void) | null = null;
	function onConfigToggle(event: Event) {
		const open = (event.currentTarget as HTMLDetailsElement).open;
		if (open) releaseLock ??= editLock.acquire();
		else {
			releaseLock?.();
			releaseLock = null;
		}
	}
	// Release if the card unmounts while still open (filter change / live removal).
	onDestroy(() => {
		releaseLock?.();
		releaseLock = null;
	});

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

	// A placed AP deep-links to its editor on the map (?ap=<id>); an unplaced one just opens
	// the map, where it's offered in the new-pin name combobox.
	const mapHref = $derived(placed ? `/map?ap=${ap.id}` : '/map');
</script>

<div
	role="button"
	tabindex="0"
	onclick={() => onfocus?.(ap.id)}
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

	<dl class="grid grid-cols-2 gap-2 border-y border-border py-3 text-center sm:grid-cols-4">
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
		<div class="flex shrink-0 items-center gap-2">
			{#if canDelete}
				<!-- Owner-only delete. Native confirm gates the destructive submit; enhance
				     reloads the page data on success (default invalidateAll). -->
				<form
					method="post"
					action="?/deleteNetwork"
					use:enhance={({ cancel }) => {
						if (!confirm(`Delete "${ap.name}"? This removes its health and location data.`))
							cancel();
						return async ({ update }) => update();
					}}
				>
					<input type="hidden" name="id" value={ap.id} />
					<button
						type="submit"
						onclick={(e) => e.stopPropagation()}
						aria-label="Delete {ap.name}"
						class="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-border text-muted transition-colors duration-150 hover:border-blocked/40 hover:text-blocked"
					>
						<Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
					</button>
				</form>
			{/if}
			<!-- Edit this AP's location on the unified map editor (deep-links via ?ap=<id>). -->
			<a
				href={mapHref}
				onclick={(e) => e.stopPropagation()}
				class="flex min-h-[44px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-muted transition-colors duration-150 hover:border-brand/40 hover:text-ink"
			>
				<Pencil class="h-3.5 w-3.5" aria-hidden="true" />
				{placed ? 'Edit on map' : 'Place on map'}
			</a>
		</div>
	</div>

	{#if canConfigure}
		<!-- Owner-only router config: interface binding + aggregate bandwidth caps. Collapsed by
		     default to keep the card compact. All interactive bits stopPropagation so editing
		     doesn't trigger the card's select-on-click. The server re-checks owner regardless. -->
		<details class="border-t border-border pt-3" ontoggle={onConfigToggle}>
			<summary
				onclick={(e) => e.stopPropagation()}
				class="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink"
			>
				<Gauge class="h-3.5 w-3.5" aria-hidden="true" />
				Router &amp; bandwidth
			</summary>
			<!-- The interactive controls below (inputs, save button, summary) each stopPropagation
			     so editing doesn't trigger the card's select-on-click; a stray click on form
			     padding harmlessly just selects the card. -->
			<form
				method="post"
				action="?/setApConfig"
				use:enhance={() => {
					savingConfig = true;
					return async ({ result, update }) => {
						await update();
						savingConfig = false;
						if (result.type === 'success') {
							const w = (result.data as { warning?: string } | undefined)?.warning;
							configFeedback = w ? { tone: 'error', msg: w } : { tone: 'ok', msg: 'Saved.' };
						} else if (result.type === 'failure') {
							const msg = (result.data as { error?: string } | undefined)?.error;
							configFeedback = { tone: 'error', msg: msg ?? 'Could not save.' };
						}
						setTimeout(() => (configFeedback = null), 5000);
					};
				}}
				class="mt-3 flex flex-col gap-2.5"
			>
				<input type="hidden" name="id" value={ap.id} />
				<label class="flex flex-col gap-1 text-[11px] font-medium text-muted">
					Router interface
					<input
						name="interfaceName"
						value={ap.interfaceName ?? ''}
						placeholder="e.g. vlan70 — blank uses the AP name"
						onclick={(e) => e.stopPropagation()}
						class="min-h-10 w-full rounded-lg border border-border bg-bg px-2.5 py-2 font-mono text-xs text-ink hover:border-brand/40 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
					/>
				</label>
				<div class="flex gap-2">
					<label class="flex flex-1 flex-col gap-1 text-[11px] font-medium text-muted">
						Max down (Mbps)
						<input
							name="maxDownMbps"
							type="number"
							min="0"
							step="0.1"
							inputmode="decimal"
							value={kbpsToMbps(ap.maxDownKbps)}
							placeholder="No limit"
							onclick={(e) => e.stopPropagation()}
							class="min-h-10 w-full rounded-lg border border-border bg-bg px-2.5 py-2 font-mono text-xs text-ink hover:border-brand/40 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
						/>
					</label>
					<label class="flex flex-1 flex-col gap-1 text-[11px] font-medium text-muted">
						Max up (Mbps)
						<input
							name="maxUpMbps"
							type="number"
							min="0"
							step="0.1"
							inputmode="decimal"
							value={kbpsToMbps(ap.maxUpKbps)}
							placeholder="No limit"
							onclick={(e) => e.stopPropagation()}
							class="min-h-10 w-full rounded-lg border border-border bg-bg px-2.5 py-2 font-mono text-xs text-ink hover:border-brand/40 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
						/>
					</label>
				</div>
				<div class="flex items-center justify-between gap-2">
					{#if configFeedback}
						<span
							role="status"
							class="text-[11px] font-medium {configFeedback.tone === 'ok'
								? 'text-online'
								: 'text-blocked'}">{configFeedback.msg}</span
						>
					{:else}
						<span class="text-[11px] text-muted">A shared cap across all guests on this AP.</span>
					{/if}
					<button
						type="submit"
						disabled={savingConfig}
						onclick={(e) => e.stopPropagation()}
						class="min-h-10 shrink-0 rounded-lg bg-brand px-3.5 py-2 text-xs font-semibold text-white transition-colors duration-150 hover:bg-brand-hover disabled:opacity-50"
					>
						{savingConfig ? 'Saving…' : 'Save'}
					</button>
				</div>
			</form>
		</details>
	{/if}
</div>
