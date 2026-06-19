<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Plus from 'lucide-svelte/icons/plus';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import Search from 'lucide-svelte/icons/search';
	import MapPin from 'lucide-svelte/icons/map-pin';
	import 'leaflet/dist/leaflet.css';
	import 'leaflet.markercluster/dist/MarkerCluster.css';
	import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { NetworkAp } from '$lib/types';
	import { routerModels, rangeFor, DEFAULT_MODEL_ID } from '$lib/router-models';

	let { networks }: { networks: NetworkAp[] } = $props();

	// Metro Manila fallback — shown when no APs have coordinates yet.
	const FALLBACK_CENTER: [number, number] = [14.5995, 120.9842];

	// Inline lucide "user" head — used in the marker hover tooltip and click popup.
	const HEAD_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

	// Coverage bands at equal-distance thirds, drawn outer→inner so the strong inner
	// band sits on top.
	// ponytail: equal-distance thirds, not log-distance RSSI. Real falloff is
	// logarithmic (see apps/admin/plan.md §2). Upgrade path: replace .frac thirds with
	// radii solved from PL(d) for target dBm cutoffs, exponent n per environment.
	const BANDS = [
		{ frac: 1.0, cls: 'cov-weak' },
		{ frac: 0.66, cls: 'cov-fair' },
		{ frac: 0.33, cls: 'cov-good' }
	];

	// A draggable map pin. apId null = a brand-new AP (posts ?/addPlace); apId set = an
	// in-place edit of an existing AP (posts ?/updatePlace, can Remove). lat/lng mirror the
	// marker, synced on drag-end, so the save form persists where the pin landed. Leaflet
	// objects live in `pinLayers` (kept out of $state — their internals fight deep proxies).
	interface Pin {
		localId: number;
		apId: string | null;
		model: string;
		/** Coverage radius in metres — defaults to the model's advertised range, then
		 * calibrated by the operator via the slider to match real-world reach. */
		range: number;
		name: string;
		address: string;
		lat: number;
		lng: number;
	}
	let pins = $state<Pin[]>([]);
	let nextLocalId = 0;
	// The real AP currently being edited — its cluster marker + dome are hidden so the
	// draggable edit pin is the only handle.
	let editingApId = $state<string | null>(null);

	let query = $state('');
	let sidebarOpen = $state(true);
	let mapReady = $state(false);

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
	let L: typeof import('leaflet') | undefined;
	let mapInstance: import('leaflet').Map | undefined;
	let clusterRef: import('leaflet').MarkerClusterGroup | undefined;
	let realDomeGroup: import('leaflet').LayerGroup | undefined;
	const markersById: Record<string, import('leaflet').Marker> = {};
	const pinLayers = new Map<
		number,
		{ marker: import('leaflet').Marker; group: import('leaflet').LayerGroup }
	>();
	// Guards against a stray map-click firing right after a marker drag.
	let suppressClick = false;

	const placed = $derived(networks.filter((ap) => ap.latitude != null && ap.longitude != null));
	const filtered = $derived(
		placed.filter((ap) => {
			const q = query.trim().toLowerCase();
			if (!q) return true;
			return ap.name.toLowerCase().includes(q) || (ap.address ?? '').toLowerCase().includes(q);
		})
	);

	function pinIcon(bg: string) {
		return L!.divIcon({
			className: 'radius-pin',
			html: `<span style="background:${bg}"></span>`,
			iconSize: [18, 18],
			iconAnchor: [9, 9]
		});
	}

	// (Re)draw the three concentric discs for one pin into its layer group.
	function drawBands(group: import('leaflet').LayerGroup, lat: number, lng: number, range: number) {
		group.clearLayers();
		for (const b of BANDS) {
			L!.circle([lat, lng], {
				radius: range * b.frac,
				stroke: false,
				className: b.cls,
				fillOpacity: 0.35
			}).addTo(group);
		}
	}

	// Real placed APs: coverage domes + clustered markers with live-count popups. The AP
	// being edited is skipped (its edit pin stands in). Re-runs when placed or editingApId
	// changes (renderReal reads both, so the $effect tracks them).
	function renderReal() {
		if (!L || !clusterRef || !realDomeGroup) return;
		clusterRef.clearLayers();
		realDomeGroup.clearLayers();
		for (const id of Object.keys(markersById)) delete markersById[id];

		for (const ap of placed) {
			if (ap.id === editingApId) continue;
			const lat = Number(ap.latitude);
			const lng = Number(ap.longitude);
			const color = ap.tone === 'online' ? 'var(--color-online)' : 'var(--color-blocked)';

			drawBands(realDomeGroup, lat, lng, ap.rangeMeters ?? rangeFor(ap.model));

			const popup = `
				<div class="radius-popup">
					<strong>${escapeHtml(ap.name)}</strong>
					${ap.address ? `<div class="radius-popup-addr">${escapeHtml(ap.address)}</div>` : ''}
					<div class="radius-popup-status">
						<span class="radius-dot" style="background:${color}"></span>${ap.status}
					</div>
					<div class="radius-popup-users">${HEAD_ICON}${ap.users} active</div>
					<button class="radius-edit-btn" type="button">Edit on map</button>
				</div>`;
			const tooltip = `<span class="radius-tip-inner">${HEAD_ICON}${ap.users}</span>`;
			const marker = L.marker([lat, lng], { icon: pinIcon(color) })
				.bindPopup(popup)
				.bindTooltip(tooltip, { direction: 'top', offset: [0, -10], className: 'radius-tip' });
			// Wire the popup's "Edit on map" button each time it opens (fresh DOM per open).
			marker.on('popupopen', (e) => {
				const btn = e.popup.getElement()?.querySelector('.radius-edit-btn');
				btn?.addEventListener('click', () => {
					mapInstance?.closePopup();
					startEdit(ap);
				});
			});
			marker.addTo(clusterRef);
			markersById[ap.id] = marker;
		}
	}

	$effect(() => {
		void placed;
		void editingApId;
		if (mapReady) renderReal();
	});

	// Spawn a draggable pin (new or edit) and its dome at the given position.
	function spawnPin(init: Omit<Pin, 'localId'>) {
		if (!L || !mapInstance) return;
		const localId = nextLocalId++;
		const map = mapInstance;
		const group = L.layerGroup().addTo(map);
		const marker = L.marker([init.lat, init.lng], {
			icon: pinIcon(init.apId ? 'var(--color-cta)' : 'var(--color-brand)'),
			draggable: true
		}).addTo(map);
		drawBands(group, init.lat, init.lng, init.range);
		marker.on('dragstart', () => (suppressClick = true));
		marker.on('drag', () => {
			const p = marker.getLatLng();
			drawBands(group, p.lat, p.lng, rangeOf(localId));
		});
		marker.on('dragend', () => {
			const p = marker.getLatLng();
			pins = pins.map((pn) => (pn.localId === localId ? { ...pn, lat: p.lat, lng: p.lng } : pn));
			setTimeout(() => (suppressClick = false), 0);
		});
		// Left-click a pin to remove it: sandbox pins vanish immediately; a saved (edit) pin
		// opens the delete-confirmation modal instead. suppressClick blocks a post-drag click.
		marker.on('click', () => {
			if (suppressClick) return;
			const pin = pins.find((pn) => pn.localId === localId);
			if (!pin) return;
			if (pin.apId) requestDelete(pin);
			else discardPin(localId);
		});
		pinLayers.set(localId, { marker, group });
		pins = [...pins, { localId, ...init }];
	}

	// Drop a fresh AP pin (map click or the "Add router" button).
	function addPin(lat: number, lng: number) {
		spawnPin({
			apId: null,
			model: DEFAULT_MODEL_ID,
			range: rangeFor(DEFAULT_MODEL_ID),
			name: '',
			address: '',
			lat,
			lng
		});
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
			model: ap.model ?? DEFAULT_MODEL_ID,
			range: ap.rangeMeters ?? rangeFor(ap.model),
			name: ap.name,
			address: ap.address ?? '',
			lat: Number(ap.latitude),
			lng: Number(ap.longitude)
		});
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

	function redrawPin(localId: number, range: number) {
		const layer = pinLayers.get(localId);
		if (layer) {
			const p = layer.marker.getLatLng();
			drawBands(layer.group, p.lat, p.lng, range);
		}
	}

	// ponytail: Nominatim public geocoder — usage policy is ~1 req/sec, no API key, and
	// it's only hit on explicit submit/Locate (no typeahead), so we stay well under it.
	// Swap for a keyed/self-hosted geocoder before heavy prod use.
	async function geocode(q: string): Promise<{ lat: number; lng: number; label: string } | null> {
		const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
		try {
			const res = await fetch(url, { headers: { Accept: 'application/json' } });
			if (!res.ok) return null;
			const data = await res.json();
			if (!Array.isArray(data) || data.length === 0) return null;
			return { lat: Number(data[0].lat), lng: Number(data[0].lon), label: String(data[0].display_name ?? q) };
		} catch {
			return null;
		}
	}

	// Standalone search: geocode the address, recenter, and drop a new pin there.
	async function searchAddress() {
		const q = addrQuery.trim();
		if (!q || !mapInstance || addrSearching) return;
		addrSearching = true;
		addrError = '';
		const hit = await geocode(q);
		addrSearching = false;
		if (!hit) {
			addrError = 'Address not found.';
			return;
		}
		mapInstance.setView([hit.lat, hit.lng], 16);
		spawnPin({
			apId: null,
			model: DEFAULT_MODEL_ID,
			range: rangeFor(DEFAULT_MODEL_ID),
			name: '',
			address: hit.label,
			lat: hit.lat,
			lng: hit.lng
		});
		addrQuery = '';
	}

	// Per-pin: geocode the pin's typed address and move that pin (+ recenter) to it.
	async function geocodePin(localId: number) {
		const pin = pins.find((p) => p.localId === localId);
		if (!pin || !pin.address.trim() || !mapInstance) return;
		geoMsg = { ...geoMsg, [localId]: 'Searching…' };
		const hit = await geocode(pin.address);
		if (!hit) {
			geoMsg = { ...geoMsg, [localId]: 'Address not found.' };
			return;
		}
		geoMsg = { ...geoMsg, [localId]: '' };
		pinLayers.get(localId)?.marker.setLatLng([hit.lat, hit.lng]);
		pins = pins.map((p) => (p.localId === localId ? { ...p, lat: hit.lat, lng: hit.lng } : p));
		redrawPin(localId, rangeOf(localId));
		mapInstance.setView([hit.lat, hit.lng], 16);
	}

	// Tear down a pin's Leaflet layers + state (shared by cancel / save / delete).
	function cleanupPin(localId: number) {
		const layer = pinLayers.get(localId);
		if (layer && mapInstance) {
			mapInstance.removeLayer(layer.marker);
			mapInstance.removeLayer(layer.group);
		}
		pinLayers.delete(localId);
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

	function selectAp(ap: NetworkAp) {
		const marker = markersById[ap.id];
		if (clusterRef && marker) {
			clusterRef.zoomToShowLayer(marker, () => marker.openPopup());
		} else if (ap.latitude && ap.longitude) {
			mapInstance?.setView([Number(ap.latitude), Number(ap.longitude)], 16);
		}
	}

	onMount(() => {
		let cancelled = false;

		(async () => {
			const mod = await import('leaflet');
			await import('leaflet.markercluster');
			if (cancelled) return;
			L = mod.default;

			const map = L.map(mapEl, { attributionControl: true, zoomControl: false }).setView(
				FALLBACK_CENTER,
				11
			);
			L.control.zoom({ position: 'bottomright' }).addTo(map);

			// ponytail: OSM public tiles — swap for a dedicated provider before heavy prod load.
			L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
				maxZoom: 19,
				attribution:
					'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
			}).addTo(map);

			const cluster = L.markerClusterGroup();
			map.addLayer(cluster);
			mapInstance = map;
			clusterRef = cluster;
			realDomeGroup = L.layerGroup().addTo(map);

			// Click empty map → drop a new AP pin (suppressed right after a marker drag).
			map.on('click', (e) => {
				if (suppressClick) return;
				addPin(e.latlng.lat, e.latlng.lng);
			});

			renderReal();
			mapReady = true;

			// Centre on the admin's location; fall back to the placed APs, else Manila.
			if (navigator.geolocation) {
				navigator.geolocation.getCurrentPosition(
					(pos) => {
						if (!cancelled) map.setView([pos.coords.latitude, pos.coords.longitude], 15);
					},
					() => {
						if (!cancelled && placed.length > 0) map.fitBounds(cluster.getBounds().pad(0.2));
					},
					{ enableHighAccuracy: false, timeout: 8000 }
				);
			} else if (placed.length > 0) {
				map.fitBounds(cluster.getBounds().pad(0.2));
			}
		})();

		return () => {
			cancelled = true;
			mapInstance?.remove();
		};
	});

	function escapeHtml(s: string): string {
		return s
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}
</script>

<div class="relative h-full w-full overflow-hidden">
	{#if sidebarOpen}
		<aside
			class="absolute top-0 bottom-0 left-0 z-[1000] flex w-72 flex-col border-r border-border bg-bg"
		>
			<header class="flex h-14 items-center justify-between gap-2 border-b border-border px-4">
				<span class="text-sm font-semibold text-ink">Access Points</span>
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
					<input
						bind:value={addrQuery}
						type="search"
						placeholder="Find an address…"
						aria-label="Find an address and drop a pin"
						class="min-h-[36px] flex-1 rounded border border-border bg-surface px-3 text-sm text-ink placeholder:text-muted focus:border-brand focus:ring-1 focus:ring-brand/20 focus:outline-none"
					/>
					<button
						type="submit"
						disabled={addrSearching || !addrQuery.trim()}
						class="flex min-h-[36px] w-9 items-center justify-center rounded border border-border bg-surface text-brand hover:bg-bg disabled:opacity-50"
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
				<input
					bind:value={query}
					type="search"
					placeholder="Filter placed APs…"
					aria-label="Filter access points"
					class="min-h-[36px] w-full rounded border border-border bg-surface px-3 text-sm text-ink placeholder:text-muted focus:border-brand focus:ring-1 focus:ring-brand/20 focus:outline-none"
				/>
			</div>

			<div class="flex-1 overflow-y-auto">
				<!-- Active pins (new + edit) — the simulate/commit workspace. -->
				{#if pins.length > 0}
					<ul class="space-y-2 border-b border-border p-3">
						{#each pins as pin (pin.localId)}
							<li class="rounded border border-border bg-surface p-2">
								<div class="flex items-center justify-between gap-2">
									<span class="text-xs font-medium text-ink">
										{pin.apId ? `Editing: ${pin.name || 'AP'}` : 'New router'}
									</span>
									<button
										onclick={() => discardPin(pin.localId)}
										class="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-bg hover:text-blocked"
										aria-label={pin.apId ? 'Cancel edit' : 'Remove pin'}
									>
										<Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
									</button>
								</div>

								<select
									value={pin.model}
									onchange={(e) => setModel(pin.localId, e.currentTarget.value)}
									class="mt-1.5 w-full rounded border border-border bg-bg px-2 py-1.5 text-xs text-ink"
								>
									{#each routerModels as m (m.id)}
										<option value={m.id}>{m.name} — {m.rangeMeters} m advertised</option>
									{/each}
								</select>

								<label class="mt-1.5 block text-xs text-muted">
									<span class="flex items-center justify-between">
										<span>Coverage radius</span>
										<span class="font-mono text-ink">{pin.range} m</span>
									</span>
									<input
										type="range"
										min="25"
										max="2000"
										step="25"
										value={pin.range}
										oninput={(e) => setRange(pin.localId, Number(e.currentTarget.value))}
										class="mt-1 w-full accent-brand"
										aria-label="Coverage radius in metres"
									/>
								</label>

								<form
									method="post"
									action={pin.apId ? '?/updatePlace' : '?/addPlace'}
									use:enhance={saveEnhance(pin.localId)}
									class="mt-1.5 space-y-1.5"
								>
									{#if pin.apId}<input type="hidden" name="id" value={pin.apId} />{/if}
									<input type="hidden" name="latitude" value={pin.lat} />
									<input type="hidden" name="longitude" value={pin.lng} />
									<input type="hidden" name="model" value={pin.model} />
									<input type="hidden" name="range" value={pin.range} />
									<input
										name="name"
										bind:value={pin.name}
										placeholder="Name this AP"
										class="w-full rounded border border-border bg-bg px-2 py-1.5 text-xs text-ink"
									/>
									<div class="flex gap-1.5">
										<input
											name="address"
											bind:value={pin.address}
											placeholder="Address (optional)"
											onkeydown={(e) => {
												if (e.key === 'Enter') {
													e.preventDefault();
													geocodePin(pin.localId);
												}
											}}
											class="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1.5 text-xs text-ink"
										/>
										<button
											type="button"
											onclick={() => geocodePin(pin.localId)}
											disabled={!pin.address.trim()}
											class="flex w-8 shrink-0 items-center justify-center rounded border border-border text-brand hover:bg-bg disabled:opacity-50"
											aria-label="Move pin to this address"
										>
											<MapPin class="h-3.5 w-3.5" aria-hidden="true" />
										</button>
									</div>
									{#if geoMsg[pin.localId]}
										<p class="text-xs {geoMsg[pin.localId] === 'Searching…' ? 'text-muted' : 'text-blocked'}">
											{geoMsg[pin.localId]}
										</p>
									{/if}
									<button
										type="submit"
										disabled={!pin.name.trim()}
										class="min-h-[36px] w-full rounded bg-brand px-2 text-xs font-medium text-white disabled:opacity-50"
									>
										{pin.apId ? 'Save changes' : 'Save to network'}
									</button>
								</form>

								{#if pin.apId}
									<button
										type="button"
										onclick={() => requestDelete(pin)}
										class="mt-1.5 min-h-[36px] w-full rounded border border-blocked px-2 text-xs font-medium text-blocked hover:bg-blocked/10"
									>
										Remove AP
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}

				{#if placed.length === 0}
					<p class="px-4 py-6 text-center text-sm text-muted">
						No router locations yet. Click the map or use
						<span class="font-medium text-ink">+ Add router</span> below.
					</p>
				{:else if filtered.length === 0}
					<p class="px-4 py-6 text-center text-sm text-muted">No match for "{query}".</p>
				{:else}
					<ul class="divide-y divide-border">
						{#each filtered as ap (ap.id)}
							<li>
								<button
									onclick={() => selectAp(ap)}
									class="flex min-h-[44px] w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-surface"
								>
									<span
										class="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
										style="background: {ap.tone === 'online'
											? 'var(--color-online)'
											: 'var(--color-blocked)'}"
									></span>
									<span class="min-w-0">
										<span class="block truncate text-sm font-medium text-ink">{ap.name}</span>
										{#if ap.address}
											<span class="block truncate text-xs text-muted">{ap.address}</span>
										{/if}
									</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			<footer class="space-y-2 border-t border-border px-3 py-2">
				<div class="flex items-center gap-3 px-1 text-xs text-muted">
					<span class="flex items-center gap-1.5"><span class="swatch" style="background: var(--color-online)"></span>Good</span>
					<span class="flex items-center gap-1.5"><span class="swatch" style="background: var(--color-warning)"></span>Fair</span>
					<span class="flex items-center gap-1.5"><span class="swatch" style="background: var(--color-blocked)"></span>Weak</span>
				</div>
				<button
					onclick={() => mapInstance && addPin(mapInstance.getCenter().lat, mapInstance.getCenter().lng)}
					disabled={!mapReady}
					class="flex min-h-[44px] w-full items-center justify-center gap-2 rounded border border-dashed border-border text-sm font-medium text-brand hover:bg-surface disabled:opacity-50"
				>
					<Plus class="h-4 w-4" aria-hidden="true" /> Add router
				</button>
				<p class="px-1 text-xs text-muted">
					{placed.length} of {networks.length} AP{networks.length === 1 ? '' : 's'} placed · click map to add
				</p>
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

	<div bind:this={mapEl} class="h-full w-full"></div>

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
	:global(.radius-pin span) {
		display: block;
		width: 18px;
		height: 18px;
		border-radius: 9999px;
		border: 2px solid white;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
	}
	/* Band fill is driven here (not via Leaflet's fillColor) because Leaflet writes
	   fillColor to the SVG `fill` attribute, where var() never resolves — a CSS
	   `fill` property overrides that attribute and stays theme-reactive. */
	:global(.cov-good) {
		fill: var(--color-online);
	}
	:global(.cov-fair) {
		fill: var(--color-warning);
	}
	:global(.cov-weak) {
		fill: var(--color-blocked);
	}
	.swatch {
		display: inline-block;
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 9999px;
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
