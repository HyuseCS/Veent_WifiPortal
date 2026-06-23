<script lang="ts">
	import { onMount, type Component } from 'svelte';
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Plus from 'lucide-svelte/icons/plus';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import Search from 'lucide-svelte/icons/search';
	import MapPin from 'lucide-svelte/icons/map-pin';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import Pencil from 'lucide-svelte/icons/pencil';
	import 'leaflet/dist/leaflet.css';
	import 'leaflet.markercluster/dist/MarkerCluster.css';
	import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { NetworkAp } from '$lib/types';
	import { SearchInput, EmptyState } from '$lib/components/ui';
	import { routerModels, rangeFor, DEFAULT_MODEL_ID } from '$lib/router-models';
	import { distanceMeters } from '$lib/geo';

	let { networks }: { networks: NetworkAp[] } = $props();

	// lucide-svelte icons type as the legacy component signature; EmptyState's `icon` prop
	// wants the runes `Component` type. Same cast the dashboard page uses.
	const icon = (c: unknown) => c as Component;

	// Metro Manila fallback — shown when no APs have coordinates yet.
	const FALLBACK_CENTER: [number, number] = [14.5995, 120.9842];

	// Inline lucide "user" head — used in the marker hover tooltip and click popup.
	const HEAD_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

	// Inline lucide "locate-fixed" — the re-center control's glyph (Leaflet controls are
	// raw HTML, so it can't be a Svelte component).
	const LOCATE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/></svg>`;

	// Inline lucide "layers" — the coverage-toggle control's glyph.
	const LAYERS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>`;

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
		/** A brand-new pin (apId null) that the operator bound to an existing *unplaced* AP via
		 * the name combobox. Saving posts ?/updatePlace for this id (sets its coords) instead of
		 * minting a duplicate. Distinct from apId so the pin stays in the workspace, not nested
		 * under a sidebar row it has no coords for yet. */
		targetId: string | null;
		model: string;
		/** Coverage radius in metres — defaults to the model's advertised range, then
		 * calibrated by the operator via the slider to match real-world reach. */
		range: number;
		name: string;
		address: string;
		lat: number;
		lng: number;
		/** Operator-assigned cluster name (null = unassigned). Only named clusters within
		 * coverage reach are offered; the server re-checks reach on save. */
		cluster: string | null;
	}
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
	const pinLayers = new Map<
		number,
		{ marker: import('leaflet').Marker; group: import('leaflet').LayerGroup }
	>();
	// Guards against a stray map-click firing right after a marker drag.
	let suppressClick = false;

	const placed = $derived(networks.filter((ap) => ap.latitude != null && ap.longitude != null));
	// APs that exist (from /networks) but were never put on the map — offered in the new-pin
	// name combobox so placing one configures that row instead of minting a duplicate.
	const unplacedAps = $derived(
		networks.filter((ap) => ap.latitude == null || ap.longitude == null)
	);

	interface Cluster {
		/** Stable key = smallest-placed-order member's id. */
		key: string;
		name: string;
		/** True if any member carries a stored clusterName (vs. the auto-number fallback). */
		named: boolean;
		members: NetworkAp[];
	}

	// Connected components of the coverage-overlap graph: two APs are linked when their domes
	// overlap (centres closer than the sum of radii). Components of ≥2 APs become named
	// clusters; lone APs stay ungrouped. The displayed name is the first member's stored
	// clusterName (mirrored across members on rename), else an auto-number.
	// ponytail: O(n²) pair scan + union-find — fine for tens of APs; swap for a spatial grid
	// only at hundreds.
	const clustering = $derived.by(() => {
		const aps = placed.map((ap) => ({
			ap,
			lat: Number(ap.latitude),
			lng: Number(ap.longitude),
			r: ap.rangeMeters ?? rangeFor(ap.model)
		}));
		const parent = aps.map((_, i) => i);
		const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
		for (let i = 0; i < aps.length; i++) {
			for (let j = i + 1; j < aps.length; j++) {
				if (distanceMeters(aps[i].lat, aps[i].lng, aps[j].lat, aps[j].lng) < aps[i].r + aps[j].r) {
					parent[find(i)] = find(j);
				}
			}
		}
		// Manual edges: APs the operator hand-assigned to the same named cluster are unioned too,
		// even if their domes don't directly overlap (hybrid auto + manual).
		const byName = new Map<string, number>();
		for (let i = 0; i < aps.length; i++) {
			const name = aps[i].ap.clusterName;
			if (!name) continue;
			const first = byName.get(name);
			if (first === undefined) byName.set(name, i);
			else parent[find(i)] = find(first);
		}
		// Group member indices by root, preserving placed order for stable labels.
		const groups = new Map<number, number[]>();
		for (let i = 0; i < aps.length; i++) {
			const root = find(i);
			const g = groups.get(root);
			if (g) g.push(i);
			else groups.set(root, [i]);
		}
		const clusters: Cluster[] = [];
		const clusteredIds = new Set<string>();
		let n = 0;
		for (const idxs of groups.values()) {
			const members = idxs.map((i) => aps[i].ap);
			const stored = members.find((m) => m.clusterName)?.clusterName ?? null;
			// A lone AP is a cluster only if the operator named it (an existing DB cluster);
			// otherwise it's just an ungrouped singleton.
			if (idxs.length < 2 && !stored) continue;
			n++;
			clusters.push({
				key: members[0].id,
				name: stored ?? `Cluster ${n}`,
				named: stored !== null,
				members
			});
			for (const m of members) clusteredIds.add(m.id);
		}
		return { clusters, clusteredIds };
	});
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

	function pinIcon(bg: string) {
		return L!.divIcon({
			className: 'radius-pin',
			html: `<span style="background:${bg}"></span>`,
			iconSize: [18, 18],
			iconAnchor: [9, 9]
		});
	}

	// Draw the three concentric discs for one AP into `group`. Does NOT clear first — the
	// caller owns clearing, because `realDomeGroup` is shared across every placed AP (clearing
	// per-call would wipe all but the last). Per-pin callers clear their own group before redraw.
	// An offline AP drops to one muted class so its dome never reads as live coverage.
	// interactive:false lets clicks fall through to the map/markers (else the fill swallows the
	// click). Fills are opaque and rendered into the 'domes' pane (group-opacity 0.35): opaque
	// discs composite top-over-bottom, so overlapping domes no longer compound into mud. An
	// overlapping AP gets a dashed warning ring on its outer disc.
	function drawBands(
		group: import('leaflet').LayerGroup,
		lat: number,
		lng: number,
		range: number,
		online = true,
		overlap = false
	) {
		for (const b of BANDS) {
			const outer = b.frac === 1.0;
			const ring = overlap && outer;
			L!.circle([lat, lng], {
				radius: range * b.frac,
				pane: 'domes',
				stroke: ring,
				weight: 2,
				dashArray: '4',
				className: (online ? b.cls : 'cov-offline') + (ring ? ' cov-overlap' : ''),
				fillOpacity: 1,
				interactive: false
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

		for (const ap of placed) {
			if (ap.id === editingApId) continue;
			const lat = Number(ap.latitude);
			const lng = Number(ap.longitude);
			const color = ap.tone === 'online' ? 'var(--color-online)' : 'var(--color-blocked)';

			if (coverageVisible) {
				const range = ap.rangeMeters ?? rangeFor(ap.model);
				drawBands(realDomeGroup, lat, lng, range, ap.tone === 'online', clusteredIds.has(ap.id));
			}

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
		}
	}

	$effect(() => {
		void placed;
		void editingApId;
		void coverageVisible;
		void clusteredIds;
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
			group.clearLayers();
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
			mapInstance?.setView([Number(ap.latitude), Number(ap.longitude)], 16);
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
		const layer = pinLayers.get(localId);
		if (layer) {
			const p = layer.marker.getLatLng();
			layer.group.clearLayers();
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
		if (!L || !mapInstance) return;
		const pts = cluster.members.map(
			(m) => [Number(m.latitude), Number(m.longitude)] as [number, number]
		);
		mapInstance.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 17 });
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
			// Dedicated dome pane at group-opacity: opaque fills composite top-over-bottom inside
			// it, so overlapping domes don't darken (see drawBands). zIndex defaults to 400 —
			// above tiles (200), below markers (600).
			map.createPane('domes').style.opacity = '0.35';

			L.control.zoom({ position: 'bottomright' }).addTo(map);

			// Re-center on the admin's location. Added after zoom so it stacks just below it
			// (Leaflet lays controls out in add order within a corner).
			const Recenter = mod.default.Control.extend({
				onAdd() {
					const bar = mod.default.DomUtil.create('div', 'leaflet-bar');
					const a = mod.default.DomUtil.create('a', 'radius-locate', bar);
					a.href = '#';
					a.title = 'My location';
					a.setAttribute('role', 'button');
					a.innerHTML = LOCATE_ICON;
					mod.default.DomEvent.on(a, 'click', mod.default.DomEvent.stop).on(a, 'click', () => {
						if (!navigator.geolocation) return;
						navigator.geolocation.getCurrentPosition(
							(pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 15),
							() => {},
							{ enableHighAccuracy: false, timeout: 8000 }
						);
					});
					return bar;
				}
			});
			new Recenter({ position: 'bottomright' }).addTo(map);

			// Toggle the real-AP coverage domes. Stacks below re-center (same add-order rule).
			const CoverageToggle = mod.default.Control.extend({
				onAdd() {
					const bar = mod.default.DomUtil.create('div', 'leaflet-bar');
					const a = mod.default.DomUtil.create('a', 'radius-locate radius-toggle is-active', bar);
					a.href = '#';
					a.title = 'Toggle coverage';
					a.setAttribute('role', 'button');
					a.setAttribute('aria-pressed', 'true');
					a.innerHTML = LAYERS_ICON;
					mod.default.DomEvent.on(a, 'click', mod.default.DomEvent.stop).on(a, 'click', () => {
						coverageVisible = !coverageVisible;
						a.classList.toggle('is-active', coverageVisible);
						a.setAttribute('aria-pressed', String(coverageVisible));
					});
					return bar;
				}
			});
			new CoverageToggle({ position: 'bottomright' }).addTo(map);

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

			// Deep-link from /networks ("Edit location"): ?ap=<id> opens that AP's editor.
			const focusId = page.url.searchParams.get('ap');
			const focusAp = focusId ? placed.find((ap) => ap.id === focusId) : undefined;
			if (focusAp) {
				toggleEdit(focusAp);
				return;
			}

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
			class="absolute top-0 bottom-0 left-0 z-[1000] flex w-85 flex-col border-r border-border bg-bg"
		>
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
					<div class="rounded border border-border bg-surface p-2">
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

								<label class="mt-1.5 block text-xs text-muted">
									<span>Cluster</span>
									<select
										value={creatingCluster[pin.localId] ? '__new__' : (pin.cluster ?? '')}
										onchange={(e) => onClusterSelect(pin.localId, e.currentTarget.value)}
										class="mt-1 w-full rounded border border-border bg-bg px-2 py-1.5 text-xs text-ink"
									>
										<option value="">None</option>
										{#each allClusterNames as name (name)}
											{@const reachable = isNameReachable(pin, name)}
											<option value={name} disabled={!reachable && name !== pin.cluster}>
												{name}{reachable ? '' : ' (out of reach)'}
											</option>
										{/each}
										<option value="__new__">+ New cluster…</option>
									</select>
								</label>
								{#if creatingCluster[pin.localId]}
									<input
										value={pin.cluster ?? ''}
										oninput={(e) => setCluster(pin.localId, e.currentTarget.value)}
										placeholder="New cluster name"
										class="mt-1.5 w-full rounded border border-border bg-bg px-2 py-1.5 text-xs text-ink"
									/>
								{/if}

								<form
									method="post"
									action={(pin.apId ?? pin.targetId) ? '?/updatePlace' : '?/addPlace'}
									use:enhance={saveEnhance(pin.localId)}
									class="mt-1.5 space-y-1.5"
								>
									{#if pin.apId ?? pin.targetId}
										<input type="hidden" name="id" value={pin.apId ?? pin.targetId} />
									{/if}
									<input type="hidden" name="latitude" value={pin.lat} />
									<input type="hidden" name="longitude" value={pin.lng} />
									<input type="hidden" name="model" value={pin.model} />
									<input type="hidden" name="range" value={pin.range} />
									<input type="hidden" name="cluster" value={pin.cluster ?? ''} />
									<!-- Name combobox: free text + an in-UI suggestion list of unplaced APs. Edit pins
									     (apId set) skip the suggestions — you don't rebind an already-placed AP. -->
									<div class="relative">
										<input
											name="name"
											value={pin.name}
											oninput={(e) => onNameInput(pin.localId, e.currentTarget.value)}
											onfocus={() => (nameOpen = pin.apId ? null : pin.localId)}
											onblur={() => (nameOpen = nameOpen === pin.localId ? null : nameOpen)}
											autocomplete="off"
											role="combobox"
											aria-expanded={nameOpen === pin.localId && nameSuggestions(pin).length > 0}
											aria-controls="name-opts-{pin.localId}"
											placeholder="Name this AP"
											class="w-full rounded border border-border bg-bg px-2 py-1.5 text-xs text-ink"
										/>
										{#if nameOpen === pin.localId && nameSuggestions(pin).length > 0}
											<ul
												id="name-opts-{pin.localId}"
												role="listbox"
												class="absolute z-10 mt-1 max-h-44 w-full overflow-y-auto rounded border border-border bg-bg shadow-md"
											>
												{#each nameSuggestions(pin) as ap (ap.id)}
													<li role="option" aria-selected={pin.name === ap.name}>
														<button
															type="button"
															onpointerdown={(e) => e.preventDefault()}
															onclick={() => {
																onNameInput(pin.localId, ap.name);
																nameOpen = null;
															}}
															class="block w-full truncate px-2 py-1.5 text-left text-xs text-ink hover:bg-surface"
														>
															{ap.name}
														</button>
													</li>
												{/each}
											</ul>
										{/if}
									</div>
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
					</div>
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
					<span class="flex items-center gap-1.5"><span class="swatch" style="background: var(--color-online)"></span>Good</span>
					<span class="flex items-center gap-1.5"><span class="swatch" style="background: var(--color-warning)"></span>Fair</span>
					<span class="flex items-center gap-1.5"><span class="swatch" style="background: var(--color-blocked)"></span>Weak</span>
					<span class="flex items-center gap-1.5"><span class="swatch" style="background: var(--color-muted)"></span>Offline</span>
				</div>
				<button
					onclick={() => mapInstance && addPin(mapInstance.getCenter().lat, mapInstance.getCenter().lng)}
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
	:global(.cov-offline) {
		fill: var(--color-muted);
	}
	/* Overlap ring: stroke via CSS for the same reason as fill — Leaflet writes stroke to the
	   SVG attribute where var() won't resolve. */
	:global(.cov-overlap) {
		stroke: var(--color-warning);
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
