<script lang="ts">
	import { onMount } from 'svelte';
	import 'leaflet/dist/leaflet.css';
	import 'leaflet.markercluster/dist/MarkerCluster.css';
	import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
	import Icon from '$lib/Icon.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Metro Manila — fallback view when no AP has coordinates yet.
	const FALLBACK_CENTER: [number, number] = [14.5995, 120.9842];

	let mapEl: HTMLDivElement;
	let query = $state('');
	let sidebarOpen = $state(true);

	// Filtered list driving the sidebar — match on name or address, case-insensitive.
	const filtered = $derived(
		data.locations.filter((l) => {
			const q = query.trim().toLowerCase();
			if (!q) return true;
			return l.name.toLowerCase().includes(q) || (l.address ?? '').toLowerCase().includes(q);
		})
	);

	// Map handles, assigned once Leaflet loads. Plain (non-reactive) — the sidebar
	// only reads them inside event handlers, never in the render path.
	let mapInstance: import('leaflet').Map | undefined;
	let clusterRef: import('leaflet').MarkerClusterGroup | undefined;
	const markersById: Record<number, import('leaflet').Marker> = {};

	/** Reveal a location's pin (un-cluster + open its popup) and pan to it. */
	function selectLocation(loc: PageData['locations'][number]) {
		const marker = markersById[loc.id];
		if (clusterRef && marker) {
			clusterRef.zoomToShowLayer(marker, () => marker.openPopup());
		} else {
			mapInstance?.setView([loc.lat, loc.lng], 16);
		}
		// On a phone the open sidebar covers the map — close it so the pin is visible.
		if (window.innerWidth < 640) sidebarOpen = false;
	}

	onMount(() => {
		let cancelled = false;

		// Leaflet touches `window`, so it can only load in the browser. Importing it
		// at module top-level would break SSR — keep it inside onMount.
		(async () => {
			const L = (await import('leaflet')).default;
			await import('leaflet.markercluster');
			if (cancelled) return;

			// Default zoom control sits top-left, under the sidebar — move it bottom-right.
			mapInstance = L.map(mapEl, { attributionControl: true, zoomControl: false }).setView(
				FALLBACK_CENTER,
				11
			);
			L.control.zoom({ position: 'bottomright' }).addTo(mapInstance);

			// ponytail: OSM's public tile server is fine for low traffic but has a
			// usage policy — swap in a dedicated tile provider before heavy prod load.
			L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
				maxZoom: 19,
				attribution:
					'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
			}).addTo(mapInstance);

			clusterRef = L.markerClusterGroup();

			for (const loc of data.locations) {
				const color = loc.online ? 'var(--color-online)' : 'var(--color-blocked)';
				const icon = L.divIcon({
					className: 'radius-pin',
					html: `<span style="background:${color}"></span>`,
					iconSize: [18, 18],
					iconAnchor: [9, 9]
				});
				const statusLabel = loc.online ? 'Online' : 'Offline';
				const popup = `
					<div class="radius-popup">
						<strong>${escapeHtml(loc.name)}</strong>
						${loc.address ? `<div class="radius-popup-addr">${escapeHtml(loc.address)}</div>` : ''}
						<div class="radius-popup-status">
							<span class="radius-dot" style="background:${color}"></span>${statusLabel}
						</div>
					</div>`;
				markersById[loc.id] = L.marker([loc.lat, loc.lng], { icon }).bindPopup(popup);
				markersById[loc.id].addTo(clusterRef);
			}

			mapInstance.addLayer(clusterRef);

			// Centre priority: the user's own location, then any plotted APs, then the
			// Metro Manila fallback already set above. Geolocation is async and needs the
			// user's permission, so the fallback shows immediately and we recentre on grant.
			const fitToAps = () => {
				if (!cancelled && clusterRef && data.locations.length > 0) {
					mapInstance?.fitBounds(clusterRef.getBounds().pad(0.2));
				}
			};
			if (navigator.geolocation) {
				navigator.geolocation.getCurrentPosition(
					(pos) => {
						if (!cancelled) mapInstance?.setView([pos.coords.latitude, pos.coords.longitude], 14);
					},
					fitToAps,
					{ enableHighAccuracy: true, timeout: 8000 }
				);
			} else {
				fitToAps();
			}
		})();

		return () => {
			cancelled = true;
			mapInstance?.remove();
		};
	});

	/** Minimal escaping — location name/address are operator-entered, rendered as raw
	 * HTML inside the popup string. */
	function escapeHtml(s: string): string {
		return s
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}
</script>

<div class="relative h-dvh w-full overflow-hidden">
	{#if sidebarOpen}
		<aside
			class="absolute top-0 bottom-0 left-0 z-[1000] flex w-full flex-col border-r border-border bg-bg sm:w-80"
		>
			<header class="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
				<div>
					<h1 class="text-lg leading-tight font-bold text-brand">Radius</h1>
					<p class="text-xs text-muted">by Parafiber — Location Finder</p>
				</div>
				<button
					onclick={() => (sidebarOpen = false)}
					class="flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-surface"
					aria-label="Hide location list"
				>
					<Icon name="x" />
				</button>
			</header>

			<div class="border-b border-border px-4 py-3">
				<div class="relative">
					<span class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">
						<Icon name="search" size={18} />
					</span>
					<input
						bind:value={query}
						type="search"
						placeholder="Search locations"
						aria-label="Search locations"
						class="min-h-[44px] w-full rounded-lg border border-border bg-bg py-3 pr-3 pl-10 text-sm text-ink focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
					/>
				</div>
			</div>

			<div class="flex-1 overflow-y-auto">
				{#if data.locations.length === 0}
					<p class="px-4 py-6 text-center text-sm text-muted">
						No access points have been placed on the map yet.
					</p>
				{:else if filtered.length === 0}
					<p class="px-4 py-6 text-center text-sm text-muted">No locations match “{query}”.</p>
				{:else}
					<ul class="divide-y divide-border">
						{#each filtered as loc (loc.id)}
							<li>
								<button
									onclick={() => selectLocation(loc)}
									class="flex min-h-[44px] w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface"
								>
									<span
										class="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
										style="background: {loc.online
											? 'var(--color-online)'
											: 'var(--color-blocked)'}"
										title={loc.online ? 'Online' : 'Offline'}
									></span>
									<span class="min-w-0">
										<span class="block truncate text-sm font-medium text-ink">{loc.name}</span>
										{#if loc.address}
											<span class="block truncate text-xs text-muted">{loc.address}</span>
										{/if}
									</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			<footer class="border-t border-border px-4 py-2 text-xs text-muted">
				{filtered.length} of {data.locations.length} deployed access point{data.locations.length ===
				1
					? ''
					: 's'}
			</footer>
		</aside>
	{:else}
		<button
			onclick={() => (sidebarOpen = true)}
			class="absolute top-3 left-3 z-[1000] flex h-11 items-center gap-2 rounded-lg border border-border bg-bg px-3 text-sm font-medium text-ink shadow-md hover:bg-surface"
			aria-label="Show location list"
		>
			<Icon name="menu" size={18} />
			Locations
		</button>
	{/if}

	<div bind:this={mapEl} class="h-full w-full"></div>
</div>

<style>
	/* divIcon dot — a themed ring around an online/offline-coloured centre. */
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
</style>
