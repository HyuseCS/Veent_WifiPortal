<script lang="ts">
	import { onMount, type Component } from 'svelte';
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Plus from 'lucide-svelte/icons/plus';
	import Search from 'lucide-svelte/icons/search';
	import MapPin from 'lucide-svelte/icons/map-pin';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import Pencil from 'lucide-svelte/icons/pencil';
	import 'leaflet/dist/leaflet.css';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { NetworkAp } from '$lib/types';
	import { SearchInput, EmptyState } from '$lib/components/ui';
	import { rangeFor, DEFAULT_MODEL_ID } from '$lib/router-models';
	import { distanceMeters } from '$lib/geo';
	import { computeClusters, type Cluster } from '$lib/clustering';
	import { geocode } from '$lib/geocode';
	import { type Pin } from '$lib/networkMap';
	import { NetworkMapController } from '$lib/networkMap.controller';
	import PinPanel from './PinPanel.svelte';

	let { networks }: { networks: NetworkAp[] } = $props();

	// lucide-svelte icons type as the legacy component signature; EmptyState's `icon` prop
	// wants the runes `Component` type. Same cast the dashboard page uses.
	const icon = (c: unknown) => c as Component;

	// Pin type + icon markup + escapeHtml now live in `$lib/networkMap` (shared with PinPanel
	// and the Leaflet controller).
	let pins = $state<Pin[]>([]);
	let nextLocalId = 0;
	// The real AP currently being edited — its cluster marker + dome are hidden so the
	// draggable edit pin is the only handle.
	let editingApId = $state<string | null>(null);

	let query = $state('');
	let sidebarOpen = $state(true);
	let mapReady = $state(false);
	// Coverage domes on/off (the Leaflet toggle control). Real-AP domes only — sandbox
	// placement pins keep their bands regardless.
	let coverageVisible = $state(true);
	// When set, only this AP's dome is shown; null = show all domes.
	let focusedApId = $state<string | null>(null);

	// Standalone address search (drops a new pin); per-pin lookups report status by localId.
	let addrQuery = $state('');
	let addrSearching = $state(false);
	let addrError = $state('');
	let geoMsg = $state<Record<number, string>>({});

	// Delete-confirmation modal target — set to the saved AP awaiting confirmation, else null.
	let confirmDelete = $state<{ localId: number; apId: string; name: string } | null>(null);
	let confirmEl = $state<HTMLDialogElement>();
	$effect(() => {
		if (confirmDelete) confirmEl?.showModal();
		else confirmEl?.close();
	});

	let mapEl: HTMLDivElement;
	// All Leaflet glue (map, layers, draggable pins, click-suppression) lives in the
	// controller; this component owns only the reactive app state.
	const mapCtl = new NetworkMapController();

	const placed = $derived(networks.filter((ap) => ap.latitude != null && ap.longitude != null));
	// APs that exist (from /networks) but were never put on the map — offered in the new-pin
	// name combobox so placing one configures that row instead of minting a duplicate.
	const unplacedAps = $derived(
		networks.filter((ap) => ap.latitude == null || ap.longitude == null)
	);

	// Coverage-overlap clustering lives in `$lib/clustering` (pure + tested); the server's
	// join guard reuses the same `$lib/reach` math so the two can't drift.
	const clustering = $derived(computeClusters(placed));
	const clusters = $derived(clustering.clusters);
	const clusteredIds = $derived(clustering.clusteredIds);

	function matchesQuery(ap: NetworkAp): boolean {
		const q = query.trim().toLowerCase();
		if (!q) return true;
		return ap.name.toLowerCase().includes(q) || (ap.address ?? '').toLowerCase().includes(q);
	}
	// Clusters with at least one member matching the filter (members narrowed to the matches).
	const visibleClusters = $derived(
		clusters
			.map((c) => ({ ...c, members: c.members.filter(matchesQuery) }))
			.filter((c) => c.members.length > 0)
	);
	// Placed APs not in any cluster, matching the filter — the flat rows.
	const singletons = $derived(
		placed.filter((ap) => !clusteredIds.has(ap.id) && matchesQuery(ap))
	);

	// Collapsed-by-key (default expanded) + which cluster's name is being edited.
	let collapsed = $state<Record<string, boolean>>({});
	let editingCluster = $state<string | null>(null);

	// Re-create markers when the AP dataset changes.
	$effect(() => {
		void placed;
		void editingApId;
		void clusteredIds;
		if (mapReady) mapCtl.renderMarkers(placed, editingApId);
	});

	// Re-draw domes when visibility, focus, or dataset changes — no marker re-creation.
	$effect(() => {
		void placed;
		void editingApId;
		void focusedApId;
		void coverageVisible;
		void clusteredIds;
		if (mapReady) mapCtl.renderDomes(placed, { coverageVisible, editingApId, focusedApId, clusteredIds });
	});

	// Scale the focused pin up (.sel) and restore all others — no marker re-creation.
	$effect(() => {
		const id = focusedApId;
		if (mapReady) mapCtl.applyFocus(id);
	});

	// Spawn a draggable pin (new or edit): the component owns the Pin record + localId, the
	// controller owns the Leaflet layer and relays drag/click events back here.
	function spawnPin(init: Omit<Pin, 'localId'>) {
		const localId = nextLocalId++;
		mapCtl.addPinLayer(
			localId,
			{ lat: init.lat, lng: init.lng, range: init.range, apId: init.apId },
			{
				getRange: () => rangeOf(localId),
				onDragEnd: (lat, lng) => {
					pins = pins.map((pn) => (pn.localId === localId ? { ...pn, lat, lng } : pn));
				},
				// sandbox pins vanish immediately; a saved (edit) pin opens the delete modal.
				onClick: () => {
					const pin = pins.find((pn) => pn.localId === localId);
					if (!pin) return;
					if (pin.apId) requestDelete(pin);
					else discardPin(localId);
				}
			}
		);
		pins = [...pins, { localId, ...init }];
	}

	// Drop a fresh AP pin (map click or the "Add router" button). If it lands within reach of a
	// cluster, pre-assign it to the nearest one and expand that group so its fields show there.
	function addPin(lat: number, lng: number) {
		const range = rangeFor(DEFAULT_MODEL_ID);
		const host = nearestCluster(lat, lng, range, null);
		spawnPin({
			apId: null,
			targetId: null,
			model: DEFAULT_MODEL_ID,
			range,
			name: '',
			address: '',
			lat,
			lng,
			// Only a named cluster is an assignable target; an unnamed auto cluster still hosts the
			// pin visually (hostCluster) and hybrid auto-overlap groups it on save.
			cluster: host?.named ? host.name : null
		});
		if (host) collapsed = { ...collapsed, [host.key]: false };
	}

	// Start editing a real AP in place: hide its marker/dome, drop a pre-filled edit pin.
	function startEdit(ap: NetworkAp) {
		if (ap.latitude == null || ap.longitude == null) return;
		// One editor at a time — discard any pin currently editing another AP.
		const existing = pins.find((p) => p.apId != null);
		if (existing) discardPin(existing.localId);
		editingApId = ap.id;
		spawnPin({
			apId: ap.id,
			targetId: null,
			model: ap.model ?? DEFAULT_MODEL_ID,
			range: ap.rangeMeters ?? rangeFor(ap.model),
			name: ap.name,
			address: ap.address ?? '',
			lat: Number(ap.latitude),
			lng: Number(ap.longitude),
			cluster: ap.clusterName
		});
		// Expand the cluster the edit panel will nest under so it's visible.
		const host =
			(ap.clusterName ? clusters.find((c) => c.name === ap.clusterName) : null) ??
			nearestCluster(
				Number(ap.latitude),
				Number(ap.longitude),
				ap.rangeMeters ?? rangeFor(ap.model),
				ap.id
			);
		if (host) collapsed = { ...collapsed, [host.key]: false };
	}

	// The sidebar AP row is the AP's edit dropdown: click opens the editor beneath it (panning
	// the map to it), click again closes it. startEdit already enforces one editor at a time, so
	// clicking a different AP switches.
	function toggleEdit(ap: NetworkAp) {
		if (editingApId === ap.id) {
			const pin = pins.find((p) => p.apId === ap.id);
			if (pin) discardPin(pin.localId);
			return;
		}
		startEdit(ap);
		if (ap.latitude != null && ap.longitude != null) {
			mapCtl.setView(Number(ap.latitude), Number(ap.longitude), 16);
		}
	}

	function rangeOf(localId: number): number {
		return pins.find((p) => p.localId === localId)?.range ?? rangeFor(DEFAULT_MODEL_ID);
	}

	// Switching model resets the calibrated range to that model's advertised figure (a
	// different device = a different baseline); the operator can re-tune from there.
	function setModel(localId: number, model: string) {
		const range = rangeFor(model);
		pins = pins.map((p) => (p.localId === localId ? { ...p, model, range } : p));
		redrawPin(localId, range);
	}

	function setRange(localId: number, range: number) {
		pins = pins.map((p) => (p.localId === localId ? { ...p, range } : p));
		redrawPin(localId, range);
	}

	function setCluster(localId: number, cluster: string | null) {
		pins = pins.map((p) => (p.localId === localId ? { ...p, cluster } : p));
	}

	// Which pin's name combobox is open (its input focused). Only one at a time.
	let nameOpen = $state<number | null>(null);
	// Unplaced APs whose name contains the pin's current text — the dropdown options. Hidden once
	// the text exactly matches one (nothing left to pick).
	function nameSuggestions(pin: Pin): NetworkAp[] {
		const q = pin.name.trim().toLowerCase();
		if (unplacedAps.some((ap) => ap.name === pin.name)) return [];
		return unplacedAps.filter((ap) => !q || ap.name.toLowerCase().includes(q)).slice(0, 6);
	}

	// New-pin name combobox: typing/selecting a name that exactly matches an unplaced AP binds the
	// pin to that row (save → updatePlace) and adopts its model/range/cluster so we don't clobber
	// them; any other text reverts to create-mode (targetId null → addPlace).
	function onNameInput(localId: number, value: string) {
		const match = unplacedAps.find((ap) => ap.name === value);
		pins = pins.map((p) => {
			if (p.localId !== localId) return p;
			if (!match) return { ...p, name: value, targetId: null };
			return {
				...p,
				name: value,
				targetId: match.id,
				model: match.model ?? DEFAULT_MODEL_ID,
				range: match.rangeMeters ?? rangeFor(match.model),
				cluster: match.clusterName ?? p.cluster
			};
		});
		if (match) redrawPin(localId, match.rangeMeters ?? rangeFor(match.model));
	}

	// Per-pin "+ New cluster…" mode (operator typing a fresh name vs picking an existing one).
	let creatingCluster = $state<Record<number, boolean>>({});
	function onClusterSelect(localId: number, value: string) {
		if (value === '__new__') {
			creatingCluster = { ...creatingCluster, [localId]: true };
			setCluster(localId, '');
		} else {
			creatingCluster = { ...creatingCluster, [localId]: false };
			setCluster(localId, value || null);
		}
	}

	// Every named cluster that exists in the DB (distinct cluster_name across placed APs), sorted.
	// The assignment dropdown lists them all; out-of-reach ones are shown disabled.
	const allClusterNames = $derived(
		[...new Set(placed.map((ap) => ap.clusterName).filter((n): n is string => !!n))].sort()
	);

	// Persist overlap clusters to the DB the moment they form, so a cluster is never a live-only
	// label: every member of a computed cluster carries its cluster_name in the DB. An unnamed
	// auto group is minted a fresh "Cluster N"; a named cluster mirrors its stored name onto any
	// member that overlap-joined without one. Reuses the nameCluster action (same mirror path an
	// operator rename uses), one cluster per tick — the next fires after the reload settles.
	// ponytail: a save that bridges two named clusters merges them under the first member's name —
	// natural fallout of the union-find, fine for an operator tool.
	let persistingCluster = false;
	$effect(() => {
		if (persistingCluster) return;
		let target: { ids: string[]; name: string } | null = null;
		for (const c of clusters) {
			if (c.named) {
				if (c.members.some((m) => m.clusterName !== c.name)) {
					target = { ids: c.members.map((m) => m.id), name: c.name };
					break;
				}
			} else {
				const used = new Set(allClusterNames);
				let n = 1;
				while (used.has(`Cluster ${n}`)) n++;
				target = { ids: c.members.map((m) => m.id), name: `Cluster ${n}` };
				break;
			}
		}
		if (!target) return;
		persistingCluster = true;
		const body = new FormData();
		body.set('ids', target.ids.join(','));
		body.set('name', target.name);
		fetch('?/nameCluster', { method: 'POST', headers: { 'x-sveltekit-action': 'true' }, body })
			.then((res) => (res.ok ? invalidateAll() : undefined))
			.finally(() => {
				persistingCluster = false;
			});
	});

	// Is `name` a join target for this pin? True when a member of that cluster (other than the pin
	// itself) is within coverage reach, or when the cluster has no other members yet (seeding).
	// Mirrors the server's clusterReachable check.
	function isNameReachable(pin: Pin, name: string): boolean {
		const others = placed.filter(
			(m) => m.clusterName === name && m.id !== pin.apId && m.latitude != null && m.longitude != null
		);
		if (others.length === 0) return true;
		return others.some(
			(m) =>
				distanceMeters(pin.lat, pin.lng, Number(m.latitude), Number(m.longitude)) <
				pin.range + (m.rangeMeters ?? rangeFor(m.model))
		);
	}

	// Nearest existing cluster (named OR auto) whose coverage a point reaches; null = none in
	// range. Used for sidebar nesting + the auto-pick on add.
	function nearestCluster(
		lat: number,
		lng: number,
		range: number,
		excludeApId: string | null
	): Cluster | null {
		let best: Cluster | null = null;
		let bestGap = 0;
		for (const c of clusters) {
			for (const m of c.members) {
				if (m.id === excludeApId || m.latitude == null || m.longitude == null) continue;
				const gap =
					distanceMeters(lat, lng, Number(m.latitude), Number(m.longitude)) -
					(range + (m.rangeMeters ?? rangeFor(m.model)));
				if (gap < 0 && (best === null || gap < bestGap)) {
					bestGap = gap;
					best = c;
				}
			}
		}
		return best;
	}

	// Which cluster group a pin shows under: its explicit (named) assignment if that cluster
	// exists, else the nearest cluster it reaches (so a new pin within range of an *unnamed*
	// auto cluster still nests there). null = the top workspace.
	function hostCluster(pin: Pin): Cluster | null {
		if (pin.cluster) {
			const c = clusters.find((x) => x.name === pin.cluster);
			if (c) return c;
		}
		return nearestCluster(pin.lat, pin.lng, pin.range, pin.apId);
	}

	// Only *new* pins (apId null) live in the workspace / cluster-top. An edit pin (apId set)
	// renders as a dropdown directly under its AP's sidebar row instead — see apRow below.
	const loosePins = $derived(pins.filter((p) => p.apId === null && hostCluster(p) === null));
	function clusterPins(key: string): Pin[] {
		return pins.filter((p) => p.apId === null && hostCluster(p)?.key === key);
	}

	function redrawPin(localId: number, range: number) {
		mapCtl.redrawPinLayer(localId, range);
	}

	// Standalone search: geocode the address, recenter, and drop a new pin there.
	async function searchAddress() {
		const q = addrQuery.trim();
		if (!q || !mapReady || addrSearching) return;
		addrSearching = true;
		addrError = '';
		const hit = await geocode(q);
		addrSearching = false;
		if (!hit) {
			addrError = 'Address not found.';
			return;
		}
		mapCtl.setView(hit.lat, hit.lng, 16);
		spawnPin({
			apId: null,
			targetId: null,
			model: DEFAULT_MODEL_ID,
			range: rangeFor(DEFAULT_MODEL_ID),
			name: '',
			address: hit.label,
			lat: hit.lat,
			lng: hit.lng,
			cluster: null
		});
		addrQuery = '';
	}

	// Per-pin: geocode the pin's typed address and move that pin (+ recenter) to it.
	async function geocodePin(localId: number) {
		const pin = pins.find((p) => p.localId === localId);
		if (!pin || !pin.address.trim() || !mapReady) return;
		geoMsg = { ...geoMsg, [localId]: 'Searching…' };
		const hit = await geocode(pin.address);
		if (!hit) {
			geoMsg = { ...geoMsg, [localId]: 'Address not found.' };
			return;
		}
		geoMsg = { ...geoMsg, [localId]: '' };
		mapCtl.movePinLayer(localId, hit.lat, hit.lng);
		pins = pins.map((p) => (p.localId === localId ? { ...p, lat: hit.lat, lng: hit.lng } : p));
		redrawPin(localId, rangeOf(localId));
		mapCtl.setView(hit.lat, hit.lng, 16);
	}

	// Tear down a pin's Leaflet layers + state (shared by cancel / save / delete).
	function cleanupPin(localId: number) {
		mapCtl.removePinLayer(localId);
		pins = pins.filter((p) => p.localId !== localId);
	}

	// Cancel: drop the pin. If it was editing a real AP, un-hide that AP again.
	function discardPin(localId: number) {
		const pin = pins.find((p) => p.localId === localId);
		cleanupPin(localId);
		if (pin?.apId) editingApId = null;
	}

	// Persist a new/edited pin via its form action, then drop the pin and reload so the AP
	// re-renders from fresh data.
	function saveEnhance(localId: number): SubmitFunction {
		return () =>
			async ({ result }) => {
				if (result.type !== 'success') return;
				const pin = pins.find((p) => p.localId === localId);
				cleanupPin(localId);
				if (pin?.apId) editingApId = null;
				await invalidateAll();
			};
	}

	// Open the delete-confirmation modal for a saved AP (edit pin). New pins never reach here.
	function requestDelete(pin: Pin) {
		if (!pin.apId) return;
		confirmDelete = { localId: pin.localId, apId: pin.apId, name: pin.name.trim() || 'this access point' };
	}

	// Confirmed deletion: posts ?/deletePlace, then drops the edit pin and reloads.
	function confirmDeleteEnhance(): SubmitFunction {
		return () =>
			async ({ result }) => {
				const target = confirmDelete;
				confirmDelete = null;
				if (result.type !== 'success' || !target) return;
				cleanupPin(target.localId);
				editingApId = null;
				await invalidateAll();
			};
	}

	// Persist a cluster name (mirrored across members server-side), then close the editor.
	function nameClusterEnhance(): SubmitFunction {
		return () =>
			async ({ result }) => {
				if (result.type !== 'success') return;
				editingCluster = null;
				await invalidateAll();
			};
	}

	// Fit the map to a cluster's members — its general location.
	function focusCluster(cluster: Cluster) {
		const pts = cluster.members.map(
			(m) => [Number(m.latitude), Number(m.longitude)] as [number, number]
		);
		mapCtl.fitBounds(pts, 0.3, 17);
	}

	onMount(() => {
		mapCtl
			.init(mapEl, {
				onReady: () => (mapReady = true),
				onMapClick: (lat, lng) => addPin(lat, lng),
				onMarkerFocus: (apId) => (focusedApId = apId),
				onPopupClose: () => (focusedApId = null),
				onEditRequest: (ap) => startEdit(ap),
				onCoverageToggle: (visible) => (coverageVisible = visible)
			})
			.then(() => {
				// Deep-link from /networks ("Edit location"): ?ap=<id> opens that AP's editor.
				const focusId = page.url.searchParams.get('ap');
				const focusAp = focusId ? placed.find((ap) => ap.id === focusId) : undefined;
				if (focusAp) {
					toggleEdit(focusAp);
					return;
				}
				// Centre on the admin's location; fall back to the placed APs, else the default centre.
				if (navigator.geolocation) {
					navigator.geolocation.getCurrentPosition(
						(pos) => mapCtl.setView(pos.coords.latitude, pos.coords.longitude, 15),
						() => {
							if (placed.length > 0) mapCtl.fitToMarkers(0.2);
						},
						{ enableHighAccuracy: false, timeout: 8000 }
					);
				} else if (placed.length > 0) {
					mapCtl.fitToMarkers(0.2);
				}
			});

		return () => mapCtl.destroy();
	});
</script>

<div class="relative h-full w-full overflow-hidden">
	{#if sidebarOpen}
		<aside
			class="absolute z-[1000] flex flex-col bg-bg shadow-2xl max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[70dvh] max-md:rounded-t-2xl max-md:border-t max-md:border-border md:top-0 md:bottom-0 md:left-0 md:w-85 md:border-r md:border-border md:shadow-none"
		>
			<!-- Drag-handle affordance — mobile bottom-sheet only. -->
			<div
				class="mx-auto mt-2 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-border md:hidden"
				aria-hidden="true"
			></div>
			<header class="flex h-14 items-center justify-between gap-2 border-b border-border px-4">
				<div class="flex items-center gap-2.5">
					<span class="text-sm font-semibold text-ink">Access Points</span>
					<span class="rounded-md bg-brand/10 px-2 py-0.5 font-mono text-xs font-bold text-brand">
						{networks.length}
					</span>
				</div>
				<button
					onclick={() => (sidebarOpen = false)}
					class="flex h-8 w-8 items-center justify-center rounded text-muted hover:bg-surface"
					aria-label="Hide list"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
				</button>
			</header>

			<!-- Address search: geocode → recenter → drop a new pin at that spot. -->
			<div class="space-y-1 border-b border-border px-3 py-2">
				<form
					onsubmit={(e) => {
						e.preventDefault();
						searchAddress();
					}}
					class="flex gap-1.5"
				>
					<SearchInput
						bind:value={addrQuery}
						placeholder="Find an address…"
						label="Find an address and drop a pin"
						class="flex-1"
					/>
					<button
						type="submit"
						disabled={addrSearching || !addrQuery.trim()}
						class="flex min-h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-brand transition-colors hover:border-brand/40 disabled:opacity-50"
						aria-label="Search address"
					>
						<Search class="h-4 w-4" aria-hidden="true" />
					</button>
				</form>
				{#if addrSearching}
					<p class="text-xs text-muted">Searching…</p>
				{:else if addrError}
					<p class="text-xs text-blocked">{addrError}</p>
				{/if}
			</div>

			<div class="border-b border-border px-3 py-2">
				<SearchInput
					bind:value={query}
					placeholder="Filter placed APs…"
					label="Filter access points"
					class="w-full"
				/>
			</div>

			<div class="flex-1 overflow-y-auto">
				<!-- New/edit pin panel — reused in the top workspace and inside a cluster group. -->
				{#snippet pinPanel(pin: Pin)}
					<PinPanel
						{pin}
						{allClusterNames}
						{creatingCluster}
						{geoMsg}
						{nameOpen}
						setNameOpen={(v) => (nameOpen = v)}
						{nameSuggestions}
						{isNameReachable}
						{saveEnhance}
						{discardPin}
						{setModel}
						{setRange}
						{setCluster}
						{onClusterSelect}
						{onNameInput}
						{geocodePin}
						{requestDelete}
					/>
				{/snippet}

				<!-- Active pins not tied to an existing cluster — the simulate/commit workspace.
				     A pin assigned to a cluster renders inside that cluster's group below. -->
				{#if loosePins.length > 0}
					<ul class="space-y-2 border-b border-border p-3">
						{#each loosePins as pin (pin.localId)}
							<li>{@render pinPanel(pin)}</li>
						{/each}
					</ul>
				{/if}

				{#snippet apRow(ap: NetworkAp)}
					<button
						onclick={() => toggleEdit(ap)}
						class="flex min-h-[44px] w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-surface {editingApId ===
						ap.id
							? 'bg-surface'
							: ''}"
						aria-expanded={editingApId === ap.id}
					>
						<span
							class="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
							style="background: {ap.tone === 'online'
								? 'var(--color-online)'
								: 'var(--color-blocked)'}"
						></span>
						<span class="min-w-0 flex-1">
							<span class="block truncate text-sm font-medium text-ink">{ap.name}</span>
							{#if ap.address}
								<span class="block truncate text-xs text-muted">{ap.address}</span>
							{/if}
						</span>
						<ChevronDown
							class="mt-1 h-4 w-4 shrink-0 text-muted transition-transform {editingApId === ap.id
								? ''
								: '-rotate-90'}"
							aria-hidden="true"
						/>
					</button>
				{/snippet}

				{#if placed.length === 0}
					<EmptyState
						icon={icon(MapPin)}
						title="No router locations yet"
						description="Click anywhere on the map, or use Add router below, to place your first AP."
						compact
					/>
				{:else if visibleClusters.length === 0 && singletons.length === 0}
					<EmptyState
						icon={icon(Search)}
						title="No matches"
						description={`No placed APs match "${query}".`}
						compact
					/>
				{:else}
					<!-- Overlap clusters: collapsible, operator-renamable groups. -->
					{#each visibleClusters as cluster (cluster.key)}
						<div class="border-b border-border">
							{#if editingCluster === cluster.key}
								<form
									method="post"
									action="?/nameCluster"
									use:enhance={nameClusterEnhance()}
									class="flex items-center gap-1.5 px-2 py-1.5"
								>
									<input type="hidden" name="ids" value={cluster.members.map((m) => m.id).join(',')} />
									<input
										name="name"
										value={cluster.named ? cluster.name : ''}
										placeholder="Name this cluster"
										class="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 text-sm text-ink"
									/>
									<button
										type="submit"
										class="min-h-[32px] shrink-0 rounded bg-brand px-2.5 text-xs font-medium text-white"
									>
										Save
									</button>
									<button
										type="button"
										onclick={() => (editingCluster = null)}
										class="min-h-[32px] shrink-0 rounded border border-border px-2 text-xs text-muted hover:text-ink"
									>
										Cancel
									</button>
								</form>
							{:else}
								<div class="flex items-center gap-1 px-2">
									<button
										type="button"
										onclick={() => (collapsed[cluster.key] = !collapsed[cluster.key])}
										class="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted hover:bg-surface hover:text-ink"
										aria-label={collapsed[cluster.key] ? 'Expand cluster' : 'Collapse cluster'}
										aria-expanded={!collapsed[cluster.key]}
									>
										<ChevronDown
											class="h-4 w-4 transition-transform {collapsed[cluster.key] ? '-rotate-90' : ''}"
											aria-hidden="true"
										/>
									</button>
									<button
										type="button"
										onclick={() => focusCluster(cluster)}
										class="flex min-h-[40px] flex-1 items-center gap-1.5 text-left"
										title="Go to this cluster on the map"
									>
										<span class="truncate text-sm font-semibold text-ink">{cluster.name}</span>
										<span class="shrink-0 text-xs text-muted">{cluster.members.length}</span>
									</button>
									<button
										type="button"
										onclick={() => (editingCluster = cluster.key)}
										class="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted hover:bg-surface hover:text-ink"
										aria-label="Rename cluster"
									>
										<Pencil class="h-3.5 w-3.5" aria-hidden="true" />
									</button>
								</div>
							{/if}
							{#if !collapsed[cluster.key]}
								{#each clusterPins(cluster.key) as pin (pin.localId)}
									<div class="border-t border-border p-2">{@render pinPanel(pin)}</div>
								{/each}
								<ul class="divide-y divide-border border-t border-border">
									{#each cluster.members as ap (ap.id)}
										{@const editPin = pins.find((p) => p.apId === ap.id)}
										<li>
											{@render apRow(ap)}
											{#if editPin}
												<div class="border-t border-border bg-bg p-2">{@render pinPanel(editPin)}</div>
											{/if}
										</li>
									{/each}
								</ul>
							{/if}
						</div>
					{/each}
					<!-- Ungrouped APs. -->
					{#if singletons.length > 0}
						<ul class="divide-y divide-border">
							{#each singletons as ap (ap.id)}
								{@const editPin = pins.find((p) => p.apId === ap.id)}
								<li>
									{@render apRow(ap)}
									{#if editPin}
										<div class="border-t border-border bg-bg p-2">{@render pinPanel(editPin)}</div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</div>

			<footer class="space-y-2 border-t border-border px-3 py-2">
				<div class="flex items-center gap-3 px-1 text-xs text-muted">
					<span class="flex items-center gap-1.5"><span class="h-2 w-2 shrink-0 rounded-full bg-online"></span>Online</span>
					<span class="flex items-center gap-1.5"><span class="h-2 w-2 shrink-0 rounded-full bg-warning"></span>Degraded</span>
					<span class="flex items-center gap-1.5"><span class="h-2 w-2 shrink-0 rounded-full bg-blocked"></span>Offline</span>
				</div>
				<button
					onclick={() => {
						const c = mapCtl.getCenter();
						if (c) addPin(c.lat, c.lng);
					}}
					disabled={!mapReady}
					class="flex min-h-[44px] w-full items-center justify-center gap-2 rounded border border-dashed border-border text-sm font-medium text-brand hover:bg-surface disabled:opacity-50"
				>
					<Plus class="h-4 w-4" aria-hidden="true" /> Add router
				</button>
				{#if clusters.length > 0}
					<p class="flex items-center gap-1.5 px-1 text-xs font-medium text-warning">
						<TriangleAlert class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
						{clusters.length} overlap cluster{clusters.length === 1 ? '' : 's'}
					</p>
				{/if}
				<div class="flex items-center gap-3 px-1">
					<div class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface">
						<div
							class="h-full rounded-full bg-online transition-[width] duration-300"
							style="width: {networks.length > 0
								? Math.round((placed.length / networks.length) * 100)
								: 0}%"
						></div>
					</div>
					<span class="shrink-0 text-xs font-medium text-muted">
						{placed.length} of {networks.length} placed
					</span>
				</div>
			</footer>
		</aside>
	{:else}
		<button
			onclick={() => (sidebarOpen = true)}
			class="absolute top-3 left-3 z-[1000] flex h-9 items-center gap-2 rounded border border-border bg-bg px-3 text-sm font-medium text-ink shadow-sm hover:bg-surface"
			aria-label="Show access point list"
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
			APs
		</button>
	{/if}

	<div bind:this={mapEl} class="peer h-full w-full"></div>

	<!-- Hover hint: how to add a pin. CSS-only (peer-hover on the map) — fades in while the
	     cursor is over the map. Bottom-centre clears the bottom-right zoom control. -->
	<div
		class="pointer-events-none absolute bottom-4 left-1/2 z-[500] -translate-x-1/2 rounded-full bg-ink/85 px-3 py-1.5 text-xs font-medium text-white opacity-0 shadow-sm backdrop-blur-sm transition-opacity duration-150 peer-hover:opacity-100"
	>
		Double-click on map to add a pin
	</div>

	<!-- Delete confirmation — only saved (DB) APs reach here; sandbox pins remove instantly. -->
	<dialog
		bind:this={confirmEl}
		onclose={() => (confirmDelete = null)}
		class="m-auto w-full max-w-sm rounded-lg border border-border bg-bg p-6 text-ink backdrop:bg-black/50"
	>
		<h2 class="text-base font-semibold text-ink">Remove access point?</h2>
		<p class="mt-1 text-sm text-muted">
			<span class="font-medium text-ink">{confirmDelete?.name ?? ''}</span> will be permanently
			deleted from the network. This cannot be undone.
		</p>
		<form
			method="post"
			action="?/deletePlace"
			use:enhance={confirmDeleteEnhance()}
			class="mt-4 flex justify-end gap-2"
		>
			<input type="hidden" name="id" value={confirmDelete?.apId ?? ''} />
			<button
				type="button"
				onclick={() => (confirmDelete = null)}
				class="min-h-[40px] rounded border border-border px-4 text-sm font-medium text-ink hover:bg-surface"
			>
				Cancel
			</button>
			<button
				type="submit"
				class="min-h-[40px] rounded bg-blocked px-4 text-sm font-medium text-white hover:opacity-90"
			>
				Remove
			</button>
		</form>
	</dialog>
</div>

<style>
	/* Coverage zone fills: CSS overrides the SVG fill/stroke attributes so var() resolves
	   correctly in both light and dark mode (Leaflet writes to SVG attributes, not CSS). */
	:global(.cov-zone-online) {
		fill: var(--color-online);
		stroke: var(--color-online);
	}
	:global(.cov-zone-warning) {
		fill: var(--color-warning);
		stroke: var(--color-warning);
	}
	:global(.cov-zone-offline) {
		fill: var(--color-muted);
		stroke: var(--color-muted);
	}
	:global(.cov-zone-brand) {
		fill: var(--color-brand);
		stroke: var(--color-brand);
	}
	:global(.leaflet-bar a.radius-locate) {
		display: flex;
		align-items: center;
		justify-content: center;
	}
	/* Coverage toggle: muted when domes are hidden, inked when shown. */
	:global(.leaflet-bar a.radius-toggle:not(.is-active)) {
		color: var(--color-muted);
	}
	:global(.radius-popup) {
		font-family: var(--font-sans);
		color: var(--color-ink);
		min-width: 9rem;
	}
	:global(.radius-popup-addr) {
		margin-top: 0.125rem;
		color: var(--color-muted);
		font-size: 0.8125rem;
	}
	:global(.radius-popup-status) {
		margin-top: 0.375rem;
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.8125rem;
	}
	:global(.radius-dot) {
		display: inline-block;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 9999px;
	}
	:global(.radius-popup-users) {
		margin-top: 0.375rem;
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-ink);
	}
	:global(.radius-edit-btn) {
		margin-top: 0.5rem;
		width: 100%;
		min-height: 32px;
		border-radius: 0.25rem;
		background: var(--color-brand);
		color: white;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
	}
	/* Hover tooltip: a compact head + count chip. */
	:global(.radius-tip .radius-tip-inner) {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-family: var(--font-sans);
		font-weight: 600;
		font-size: 0.75rem;
		color: var(--color-ink);
	}
</style>
