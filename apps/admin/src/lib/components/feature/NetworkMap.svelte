<script lang="ts">
	import { onMount } from 'svelte';
	import Plus from 'lucide-svelte/icons/plus';
	import 'leaflet/dist/leaflet.css';
	import 'leaflet.markercluster/dist/MarkerCluster.css';
	import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
	import type { NetworkAp } from '$lib/types';
	import AddPlaceDialog from './AddPlaceDialog.svelte';

	let { networks }: { networks: NetworkAp[] } = $props();

	// Metro Manila fallback — shown when no APs have coordinates yet.
	const FALLBACK_CENTER: [number, number] = [14.5995, 120.9842];

	// Inline lucide "user" head — used in the dot's hover tooltip and click popup.
	const HEAD_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

	let mapEl: HTMLDivElement;
	let query = $state('');
	let sidebarOpen = $state(true);
	let addOpen = $state(false);

	// APs that have both coordinates set — the only ones the map can render.
	const placed = $derived(
		networks.filter((ap) => ap.latitude != null && ap.longitude != null)
	);

	const filtered = $derived(
		placed.filter((ap) => {
			const q = query.trim().toLowerCase();
			if (!q) return true;
			return ap.name.toLowerCase().includes(q) || (ap.address ?? '').toLowerCase().includes(q);
		})
	);

	let L: typeof import('leaflet') | undefined;
	let mapInstance: import('leaflet').Map | undefined;
	let clusterRef: import('leaflet').MarkerClusterGroup | undefined;
	const markersById: Record<string, import('leaflet').Marker> = {};
	let mapReady = $state(false);

	// (Re)build pins from the placed APs. Runs on init and again whenever the placed
	// set changes — e.g. right after the operator adds a location.
	function renderMarkers() {
		if (!L || !clusterRef) return;
		clusterRef.clearLayers();
		for (const id of Object.keys(markersById)) delete markersById[id];
		for (const ap of placed) {
			const color = ap.tone === 'online' ? 'var(--color-online)' : 'var(--color-blocked)';
			const icon = L.divIcon({
				className: 'radius-pin',
				html: `<span style="background:${color}"></span>`,
				iconSize: [18, 18],
				iconAnchor: [9, 9]
			});
			const popup = `
				<div class="radius-popup">
					<strong>${escapeHtml(ap.name)}</strong>
					${ap.address ? `<div class="radius-popup-addr">${escapeHtml(ap.address)}</div>` : ''}
					<div class="radius-popup-status">
						<span class="radius-dot" style="background:${color}"></span>${ap.status}
					</div>
					<div class="radius-popup-users">${HEAD_ICON}${ap.users} active</div>
				</div>`;
			// Hover tooltip: a small head + the live active-user count.
			const tooltip = `<span class="radius-tip-inner">${HEAD_ICON}${ap.users}</span>`;
			markersById[ap.id] = L.marker([Number(ap.latitude!), Number(ap.longitude!)], { icon })
				.bindPopup(popup)
				.bindTooltip(tooltip, { direction: 'top', offset: [0, -10], className: 'radius-tip' });
			markersById[ap.id].addTo(clusterRef);
		}
	}

	// Keep pins in sync with the data once the map exists (picks up newly added places).
	$effect(() => {
		void placed;
		if (mapReady) renderMarkers();
	});

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

			// Locals keep TS's null-narrowing through the renderMarkers() call below
			// (it can't prove the module-scoped refs aren't reassigned).
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
			renderMarkers();
			mapReady = true;

			// Centre on the admin's current location. Fallback (denied/unavailable):
			// fit to the placed APs, else the Manila default already set above.
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

			<div class="border-b border-border px-3 py-2">
				<input
					bind:value={query}
					type="search"
					placeholder="Search APs…"
					aria-label="Search access points"
					class="min-h-[36px] w-full rounded border border-border bg-surface px-3 text-sm text-ink placeholder:text-muted focus:border-brand focus:ring-1 focus:ring-brand/20 focus:outline-none"
				/>
			</div>

			<div class="flex-1 overflow-y-auto">
				{#if placed.length === 0}
					<p class="px-4 py-6 text-center text-sm text-muted">
						No router locations yet. Use
						<span class="font-medium text-ink">+ Add router location</span> below.
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
				<!-- Admin-only "drop a router on the map" entry point. -->
				<button
					onclick={() => (addOpen = true)}
					class="flex min-h-[44px] w-full items-center justify-center gap-2 rounded border border-dashed border-border text-sm font-medium text-brand hover:bg-surface"
				>
					<Plus class="h-4 w-4" aria-hidden="true" /> Add router location
				</button>
				<p class="px-1 text-xs text-muted">
					{placed.length} of {networks.length} AP{networks.length === 1 ? '' : 's'} placed
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

	<AddPlaceDialog bind:open={addOpen} />
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
