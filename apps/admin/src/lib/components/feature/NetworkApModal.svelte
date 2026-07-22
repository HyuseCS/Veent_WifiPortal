<script lang="ts">
	import Wifi from 'lucide-svelte/icons/wifi';
	import MapPin from 'lucide-svelte/icons/map-pin';
	import Pencil from 'lucide-svelte/icons/pencil';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import Gauge from 'lucide-svelte/icons/gauge';
	import X from 'lucide-svelte/icons/x';
	import type { Component } from 'svelte';
	import { enhance } from '$app/forms';
	import type { NetworkAp } from '$lib/types';
	import { BaseDialog, IconButton, StatusBadge } from '$lib/components/ui';

	// The full detail view for one AP card. Opened by clicking a card on the Networks page; holds
	// every card detail plus the owner controls (router config, delete) and the operator display-name
	// editor (managers only). `name` shown here is the resolved label (display_name ?? router name);
	// saving writes only the display_name override, so it survives every router refresh.
	type GroupMember = { name: string; tone: 'online' | 'warning' | 'blocked'; status: string };
	let {
		ap,
		open = $bindable(false),
		group,
		canManage = false,
		canDelete = false,
		canConfigure = false
	}: {
		ap: NetworkAp | null;
		open?: boolean;
		group?: { members: GroupMember[] };
		/** owner + system_admin: may rename the AP (edit the display-name override). */
		canManage?: boolean;
		/** Owner-only: show the delete control (the server re-checks owner regardless). */
		canDelete?: boolean;
		/** Owner-only: show the router config (interface binding + bandwidth caps) editor. */
		canConfigure?: boolean;
	} = $props();

	const isAp = $derived(ap?.attributionSource === 'circuit-id');
	const trafficUnavailable = $derived(ap?.throughput === '—');

	// Kbps (stored) → Mbps (shown/edited). Blank when uncapped so the field reads "no limit".
	const kbpsToMbps = (kbps: number | null): string => (kbps == null ? '' : String(kbps / 1000));

	// Local form state, re-seeded on every open so switching between cards never leaks stale values.
	let nameInput = $state('');
	let savingName = $state(false);
	let nameFeedback = $state<{ tone: 'ok' | 'error'; msg: string } | null>(null);
	let savingConfig = $state(false);
	let configFeedback = $state<{ tone: 'ok' | 'error'; msg: string } | null>(null);
	function reset() {
		nameInput = ap?.name ?? '';
		savingName = false;
		nameFeedback = null;
		savingConfig = false;
		configFeedback = null;
	}

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
		const t = num(ap?.throughput ?? '');
		return Number.isFinite(t) ? Math.min(100, Math.round((t / 120) * 100)) : 0;
	});
	// Latency colour bands, independent of overall status.
	const latColor = $derived.by(() => {
		const l = num(ap?.latency ?? '');
		if (!Number.isFinite(l)) return 'text-muted';
		if (l < 20) return 'text-online';
		if (l < 40) return 'text-warning';
		return 'text-blocked';
	});

	const metrics = $derived(
		ap
			? [
					{ label: 'Uptime', value: ap.uptime, class: 'text-ink', title: undefined as string | undefined },
					{ label: 'Latency', value: ap.latency, class: latColor, title: undefined as string | undefined },
					{ label: 'Users', value: String(ap.users), class: 'text-ink', title: undefined as string | undefined },
					{
						label: 'Tput',
						value: ap.throughput,
						class: trafficUnavailable ? 'text-muted' : 'text-ink',
						title: trafficUnavailable ? 'Per-AP traffic unavailable on this firmware' : undefined
					}
				]
			: []
	);

	const placed = $derived(ap != null && ap.latitude != null && ap.longitude != null);
	const coordText = $derived(
		placed
			? `${Number(ap!.latitude).toFixed(4)}, ${Number(ap!.longitude).toFixed(4)}`
			: 'Not placed on map'
	);
	// A placed AP deep-links to its editor on the map (?ap=<id>); an unplaced one just opens the map.
	const mapHref = $derived(placed ? `/map?ap=${ap!.id}` : '/map');
</script>

<BaseDialog bind:open {reset} class="max-w-lg">
	{#if ap}
		<div class="flex items-start justify-between gap-3">
			<div class="flex min-w-0 items-center gap-3">
				<span
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg {toneIcon[ap.tone]}"
					aria-hidden="true"
				>
					<Wifi class="h-5 w-5" />
				</span>
				<div class="min-w-0">
					<h2 class="truncate text-base font-semibold text-ink">{ap.name}</h2>
					{#if ap.mac}
						<div class="truncate font-mono text-xs text-muted">{ap.mac}</div>
					{/if}
					{#if ap.address}
						<div class="truncate text-xs text-muted">{ap.address}</div>
					{/if}
				</div>
			</div>
			<div class="flex shrink-0 items-center gap-2">
				<StatusBadge tone={ap.tone} label={ap.status} pulse={ap.tone !== 'online'} />
				<IconButton icon={X as unknown as Component} onclick={() => (open = false)} label="Close" />
			</div>
		</div>

		<!-- Scroll the body, not the whole panel: the header (with the close button) stays visible
		     even when the config editor + delete make the content taller than the viewport. -->
		<div class="max-h-[70vh] overflow-y-auto pr-0.5">
		{#if canManage}
			<!-- Operator display name. Writes only the display_name override (survives router refresh);
			     blank reverts to the router-derived name. -->
			<form
				method="post"
				action="?/setApName"
				use:enhance={() => {
					savingName = true;
					return async ({ result, update }) => {
						await update({ reset: false });
						savingName = false;
						if (result.type === 'success') {
							nameFeedback = { tone: 'ok', msg: 'Saved.' };
						} else if (result.type === 'failure') {
							const msg = (result.data as { error?: string } | undefined)?.error;
							nameFeedback = { tone: 'error', msg: msg ?? 'Could not save.' };
						}
						setTimeout(() => (nameFeedback = null), 5000);
					};
				}}
				class="mt-4 flex flex-col gap-1.5"
			>
				<input type="hidden" name="id" value={ap.id} />
				<label class="text-[11px] font-medium text-muted" for="ap-name-input">Display name</label>
				<div class="flex gap-2">
					<input
						id="ap-name-input"
						name="displayName"
						bind:value={nameInput}
						maxlength="120"
						placeholder="AP name"
						class="min-h-10 flex-1 rounded-lg border border-border bg-bg px-2.5 py-2 text-sm text-ink hover:border-brand/40 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
					/>
					<button
						type="submit"
						disabled={savingName}
						class="min-h-10 shrink-0 rounded-lg bg-brand px-3.5 py-2 text-xs font-semibold text-white transition-colors duration-150 hover:bg-brand-hover disabled:opacity-50"
					>
						{savingName ? 'Saving…' : 'Save'}
					</button>
				</div>
				{#if nameFeedback}
					<span
						role="status"
						class="text-[11px] font-medium {nameFeedback.tone === 'ok'
							? 'text-online'
							: 'text-blocked'}">{nameFeedback.msg}</span
					>
				{:else}
					<span class="text-[10px] text-muted">Blank reverts to the router-detected name.</span>
				{/if}
			</form>
		{/if}

		{#if group}
			<!-- Shared-ONU group: the router can't split these APs (they answer on one ONU/circuit-id),
			     so we show them honestly with each member's own up/down. -->
			<div class="mt-4 flex flex-col gap-2 rounded-lg border border-border/70 bg-surface/40 p-2.5">
				<p class="text-[11px] font-medium text-muted">
					Shared ONU — the router cannot split these {group.members.length} APs.
				</p>
				<ul class="flex flex-col gap-1.5">
					{#each group.members as m (m.name)}
						<li class="flex items-center justify-between gap-2">
							<span class="min-w-0 truncate text-xs font-medium text-ink">{m.name}</span>
							<StatusBadge tone={m.tone} label={m.status} pulse={m.tone !== 'online'} />
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<dl class="mt-4 grid grid-cols-2 gap-2 border-y border-border py-3 text-center sm:grid-cols-4">
			{#each metrics as metric (metric.label)}
				<div class="flex flex-col gap-1">
					<dt class="text-[10px] font-bold tracking-wide text-muted uppercase">{metric.label}</dt>
					<dd class="font-mono text-sm font-semibold {metric.class}" title={metric.title}>
						{metric.value}
					</dd>
				</div>
			{/each}
		</dl>

		<div class="mt-4 flex flex-col gap-1.5">
			<div class="flex items-center justify-between">
				<span class="text-xs font-medium text-muted">Uplink load</span>
				<span class="font-mono text-xs font-medium text-muted">{loadPct}%</span>
			</div>
			<div class="h-1.5 overflow-hidden rounded bg-surface">
				<div class="h-full rounded {toneBar[ap.tone]}" style="width: {loadPct}%"></div>
			</div>
		</div>

		<div class="mt-4 flex items-center justify-between gap-2">
			<span class="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted">
				<MapPin
					class="h-3.5 w-3.5 shrink-0 {placed ? 'text-brand' : 'text-muted'}"
					aria-hidden="true"
				/>
				<span class="truncate">{coordText}</span>
			</span>
			<a
				href={mapHref}
				class="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-muted transition-colors duration-150 hover:border-brand/40 hover:text-ink"
			>
				<Pencil class="h-3.5 w-3.5" aria-hidden="true" />
				{placed ? 'Edit on map' : 'Place on map'}
			</a>
		</div>

		{#if canConfigure}
			<!-- Owner-only router config: interface binding + aggregate bandwidth caps. The server
			     re-checks owner regardless. -->
			<form
				method="post"
				action="?/setApConfig"
				use:enhance={() => {
					savingConfig = true;
					return async ({ result, update }) => {
						await update({ reset: false });
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
				class="mt-4 flex flex-col gap-2.5 border-t border-border pt-4"
			>
				<div class="flex items-center gap-1.5 text-xs font-semibold text-muted">
					<Gauge class="h-3.5 w-3.5" aria-hidden="true" />
					Router &amp; bandwidth
				</div>
				<input type="hidden" name="id" value={ap.id} />
				<label class="flex flex-col gap-1 text-[11px] font-medium text-muted">
					Router interface
					<input
						name="interfaceName"
						value={ap.interfaceName ?? ''}
						placeholder="e.g. vlan70 — blank uses the AP name"
						class="min-h-10 w-full rounded-lg border border-border bg-bg px-2.5 py-2 font-mono text-xs text-ink hover:border-brand/40 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
					/>
					{#if isAp && !ap.interfaceName}
						<span class="text-[10px] text-muted">
							Auto-discovered AP — bind a router interface for speed caps to reach the router.
						</span>
					{/if}
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
						class="min-h-10 shrink-0 rounded-lg bg-brand px-3.5 py-2 text-xs font-semibold text-white transition-colors duration-150 hover:bg-brand-hover disabled:opacity-50"
					>
						{savingConfig ? 'Saving…' : 'Save'}
					</button>
				</div>
			</form>
		{/if}

		{#if canDelete}
			<!-- Owner-only delete. Native confirm gates the destructive submit; closes the modal on
			     success (the page's invalidateAll reload drops the row). -->
			<form
				method="post"
				action="?/deleteNetwork"
				use:enhance={({ cancel }) => {
					if (!confirm(`Delete "${ap!.name}"? This removes its health and location data.`)) cancel();
					return async ({ result, update }) => {
						await update();
						if (result.type === 'success') open = false;
					};
				}}
				class="mt-4 border-t border-border pt-4"
			>
				<input type="hidden" name="id" value={ap.id} />
				<button
					type="submit"
					class="flex min-h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-muted transition-colors duration-150 hover:border-blocked/40 hover:text-blocked"
				>
					<Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
					Delete access point
				</button>
			</form>
		{/if}
		</div>
	{/if}
</BaseDialog>
