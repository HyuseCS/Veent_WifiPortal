<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import 'leaflet/dist/leaflet.css';
	import Icon from '$lib/Icon.svelte';
	import { FALLBACK_CENTER, TILE_SUBDOMAINS, TILE_ATTRIBUTION, tileUrl } from '$lib/map';
	import { groupByCluster } from '$lib/clusters';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Inline lucide "locate-fixed" — the recenter control's glyph (Leaflet controls are raw HTML,
	// so it can't be the Svelte Icon component).
	const LOCATE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/></svg>`;

	let mapEl: HTMLDivElement;
	let query = $state('');
	let sidebarOpen = $state(true);

	// Theme toggle. Default follows the OS (seeded pre-paint in app.html); the toggle overrides and
	// persists. The map re-tiles via a data-theme MutationObserver, so flipping this is enough.
	let theme = $state(
		browser && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
	);
	function toggleTheme() {
		theme = theme === 'dark' ? 'light' : 'dark';
		document.documentElement.dataset.theme = theme;
		try {
			localStorage.setItem('radius-locator-theme', theme);
		} catch {
			// localStorage unavailable (private mode) — choice still applies for the session.
		}
	}

	// Mobile bottom-sheet drag-to-dismiss: the sheet follows the finger down (sheetDragY), and
	// releasing past 30% of its height closes it; below that it snaps back. Desktop never drags
	// (the handle is md:hidden), so sheetDragY stays 0 and the transform is identity there.
	let sheetEl = $state<HTMLElement>();
	let sheetDragY = $state(0);
	let sheetDragging = $state(false);
	let sheetStartY = 0;
	function onSheetDown(e: PointerEvent) {
		sheetDragging = true;
		sheetStartY = e.clientY;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onSheetMove(e: PointerEvent) {
		if (!sheetDragging) return;
		sheetDragY = Math.max(0, e.clientY - sheetStartY); // down-only
	}
	function onSheetUp() {
		if (!sheetDragging) return;
		sheetDragging = false;
		if (sheetDragY > (sheetEl?.offsetHeight ?? 300) * 0.3) sidebarOpen = false;
		sheetDragY = 0; // dismiss or snap back — reset for next open
	}

	// Filtered list driving the sidebar — match on name or address, case-insensitive.
	const filtered = $derived(
		data.locations.filter((l) => {
			const q = query.trim().toLowerCase();
			if (!q) return true;
			return l.name.toLowerCase().includes(q) || (l.address ?? '').toLowerCase().includes(q);
		})
	);

	type Loc = PageData['locations'][number];

	// The visitor's location once geolocation resolves — drives nearest-first ordering. null until
	// granted (or if denied), in which case the groups fall back to alphabetical.
	let userLoc = $state<{ lat: number; lng: number } | null>(null);
	// Per-cluster collapse state (default expanded).
	let collapsed = $state<Record<string, boolean>>({});

	// Group the filtered APs by their operator-assigned cluster (mirrored from admin's map) and
	// order both clusters and ungrouped APs nearest-first to the visitor. Logic is pure + tested in
	// `$lib/clusters`.
	const groups = $derived(groupByCluster(filtered, userLoc));

	// Map handles, assigned once Leaflet loads. Plain (non-reactive) — the sidebar
	// only reads them inside event handlers, never in the render path.
	let mapInstance: import('leaflet').Map | undefined;
	const markersById: Record<number, import('leaflet').Marker> = {};

	// Re-tiles the basemap when data-theme flips (toggle or pre-paint). Disconnected on unmount.
	let themeObs: MutationObserver | undefined;

	/** Pan + zoom to a location and open its popup. */
	function selectLocation(loc: Loc) {
		mapInstance?.setView([loc.lat, loc.lng], 16);
		markersById[loc.id]?.openPopup();
		// On a phone the bottom sheet covers the lower map — close it so the panned-to pin is visible.
		if (window.innerWidth < 768) sidebarOpen = false;
	}

	/** Fit the map to a cluster's members — its general area. */
	function focusCluster(cluster: { members: Loc[] }) {
		if (!mapInstance || cluster.members.length === 0) return;
		const pts = cluster.members.map((m) => [m.lat, m.lng] as [number, number]);
		mapInstance.fitBounds(pts, { padding: [48, 48], maxZoom: 17 });
		if (window.innerWidth < 768) sidebarOpen = false;
	}

	onMount(() => {
		let cancelled = false;

		// Leaflet touches `window`, so it can only load in the browser. Importing it
		// at module top-level would break SSR — keep it inside onMount.
		(async () => {
			const L = (await import('leaflet')).default;
			if (cancelled) return;

			// Default zoom control sits top-left, under the sidebar — move it bottom-right.
			mapInstance = L.map(mapEl, { attributionControl: true, zoomControl: false }).setView(
				FALLBACK_CENTER,
				11
			);
			L.control.zoom({ position: 'bottomright' }).addTo(mapInstance);

			// Recenter on the visitor's location. Added after zoom so it stacks just below it
			// (Leaflet lays controls out in add order within a corner).
			const Recenter = L.Control.extend({
				onAdd() {
					const bar = L.DomUtil.create('div', 'leaflet-bar');
					const a = L.DomUtil.create('a', 'radius-locate', bar);
					a.href = '#';
					a.title = 'My location';
					a.setAttribute('role', 'button');
					a.setAttribute('aria-label', 'Recenter on my location');
					a.innerHTML = LOCATE_ICON;
					L.DomEvent.on(a, 'click', L.DomEvent.stop).on(a, 'click', () => {
						if (!navigator.geolocation) return;
						navigator.geolocation.getCurrentPosition(
							(pos) => {
								// Keep the sidebar's nearest-first ordering in sync, like the initial flow.
								userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
								mapInstance?.setView([pos.coords.latitude, pos.coords.longitude], 15);
							},
							() => {},
							{ enableHighAccuracy: true, timeout: 8000 }
						);
					});
					return bar;
				}
			});
			new Recenter({ position: 'bottomright' }).addTo(mapInstance);

			// CARTO basemap (Voyager / Dark Matter, matching admin), themed to the current data-theme;
			// re-tiles live when the theme toggle flips the attribute.
			const tileLayer = L.tileLayer(tileUrl(), {
				maxZoom: 19,
				subdomains: TILE_SUBDOMAINS,
				attribution: TILE_ATTRIBUTION
			}).addTo(mapInstance);
			themeObs = new MutationObserver(() => tileLayer.setUrl(tileUrl()));
			themeObs.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ['data-theme']
			});

			// Individual teardrop pins (no proximity clustering) — matches admin's map; the cluster
			// grouping lives in the sidebar instead. featureGroup so getBounds() works for fit-to-all.
			const markerGroup = L.featureGroup().addTo(mapInstance);

			for (const loc of data.locations) {
				const color = loc.online ? 'var(--color-online)' : 'var(--color-blocked)';
				// Teardrop pin (shared visual language with the admin map), colored by status via --c.
				const icon = L.divIcon({
					className: '',
					html: `<div class="vpin" style="--c:${color}"><span></span></div>`,
					iconSize: [22, 22],
					iconAnchor: [11, 22],
					popupAnchor: [0, -20]
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
				markersById[loc.id] = L.marker([loc.lat, loc.lng], { icon })
					.bindPopup(popup)
					.addTo(markerGroup);
			}

			// Centre priority: the user's own location, then any plotted APs, then the
			// Metro Manila fallback already set above. Geolocation is async and needs the
			// user's permission, so the fallback shows immediately and we recentre on grant.
			const fitToAps = () => {
				if (cancelled || data.locations.length === 0) return;
				const b = markerGroup.getBounds();
				if (b.isValid()) mapInstance?.fitBounds(b.pad(0.2));
			};
			if (navigator.geolocation) {
				navigator.geolocation.getCurrentPosition(
					(pos) => {
						if (cancelled) return;
						// Record the visitor's position so the sidebar can order clusters nearest-first.
						userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
						mapInstance?.setView([pos.coords.latitude, pos.coords.longitude], 14);
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
			themeObs?.disconnect();
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
			bind:this={sheetEl}
			style="transform: translateY({sheetDragY}px)"
			class="absolute z-[1000] flex flex-col bg-bg shadow-2xl max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[75dvh] max-md:rounded-t-2xl max-md:border-t max-md:border-border md:top-0 md:bottom-0 md:left-0 md:w-80 md:border-r md:border-border md:shadow-none {sheetDragging
				? ''
				: 'transition-transform duration-200 motion-reduce:transition-none'}"
		>
			<!-- Drag handle — mobile bottom-sheet only. The padded zone is a ~44px touch target;
			     drag it down past 30% of the sheet to dismiss (snaps back below that). The header
			     close button is the keyboard/screen-reader equivalent. -->
			<div
				class="flex min-h-[44px] shrink-0 cursor-grab touch-none items-center justify-center md:hidden"
				onpointerdown={onSheetDown}
				onpointermove={onSheetMove}
				onpointerup={onSheetUp}
				onpointercancel={onSheetUp}
				role="button"
				tabindex="-1"
				aria-label="Drag to dismiss location list"
			>
				<span class="h-1.5 w-10 rounded-full bg-border" aria-hidden="true"></span>
			</div>

			<header class="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
				<div>
					<h1 class="text-lg leading-tight font-bold text-brand">Radius</h1>
					<p class="text-xs text-muted">by Parafiber — Location Finder</p>
				</div>
				<div class="flex items-center gap-1">
					<button
						onclick={toggleTheme}
						class="flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-surface"
						aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
						aria-pressed={theme === 'dark'}
					>
						<Icon name={theme === 'dark' ? 'sun' : 'moon'} />
					</button>
					<button
						onclick={() => (sidebarOpen = false)}
						class="flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-surface"
						aria-label="Hide location list"
					>
						<Icon name="x" />
					</button>
				</div>
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

			<div class="flex-1 overflow-y-auto overscroll-contain">
				<!-- One location row — reused inside cluster groups and the ungrouped section. -->
				{#snippet locRow(loc: Loc)}
					<button
						onclick={() => selectLocation(loc)}
						class="flex min-h-[44px] w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface"
					>
						<span
							class="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
							style="background: {loc.online ? 'var(--color-online)' : 'var(--color-blocked)'}"
							aria-hidden="true"
						></span>
						<span class="min-w-0">
							<span class="block truncate text-sm font-medium text-ink">{loc.name}</span>
							{#if loc.address}
								<span class="block truncate text-xs text-muted">{loc.address}</span>
							{/if}
							<!-- Status as text, not color alone (PRODUCT.md: no color-only indicators). -->
							<span class="sr-only">{loc.online ? 'Online' : 'Offline'}</span>
						</span>
					</button>
				{/snippet}

				{#if data.locations.length === 0}
					<p class="px-4 py-6 text-center text-sm text-muted">
						No access points have been placed on the map yet.
					</p>
				{:else if filtered.length === 0}
					<p class="px-4 py-6 text-center text-sm text-muted">No locations match “{query}”.</p>
				{:else}
					<!-- Cluster groups (from admin's cluster_name), nearest-first. Collapsible; the name
					     row fits the map to that cluster. -->
					{#each groups.clusters as cluster (cluster.name)}
						<div class="border-b border-border">
							<div class="flex items-center gap-1 px-2">
								<button
									type="button"
									onclick={() => (collapsed[cluster.name] = !collapsed[cluster.name])}
									class="flex h-11 w-11 shrink-0 items-center justify-center rounded text-muted hover:bg-surface hover:text-ink"
									aria-label={collapsed[cluster.name] ? 'Expand cluster' : 'Collapse cluster'}
									aria-expanded={!collapsed[cluster.name]}
								>
									<span
										class="inline-flex transition-transform motion-reduce:transition-none {collapsed[
											cluster.name
										]
											? '-rotate-90'
											: ''}"
									>
										<Icon name="chevron-down" size={16} />
									</span>
								</button>
								<button
									type="button"
									onclick={() => focusCluster(cluster)}
									class="flex min-h-[44px] flex-1 items-center gap-2 text-left"
									title="Show this cluster on the map"
								>
									<span class="truncate text-sm font-semibold text-ink">{cluster.name}</span>
									<span class="shrink-0 font-mono text-xs text-muted">{cluster.members.length}</span>
								</button>
							</div>
							{#if !collapsed[cluster.name]}
								<ul class="divide-y divide-border border-t border-border">
									{#each cluster.members as loc (loc.id)}
										<li>{@render locRow(loc)}</li>
									{/each}
								</ul>
							{/if}
						</div>
					{/each}

					<!-- Ungrouped APs (no cluster), nearest-first, after the clusters. -->
					{#if groups.singles.length > 0}
						<ul class="divide-y divide-border">
							{#each groups.singles as loc (loc.id)}
								<li>{@render locRow(loc)}</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</div>
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
	/* Teardrop status pin — shared visual language with the admin map. Color is driven by the
	   --c inline custom property so each marker sets its own status tone. */
	:global(.vpin) {
		width: 22px;
		height: 22px;
		border-radius: 50% 50% 50% 0;
		transform: rotate(-45deg);
		background: var(--c, var(--color-online));
		border: 2.5px solid #fff;
		box-shadow: 0 2px 7px rgba(10, 21, 80, 0.45);
		position: relative;
	}
	:global(.vpin span) {
		position: absolute;
		inset: 0;
		margin: auto;
		width: 7px;
		height: 7px;
		background: #fff;
		border-radius: 50%;
		transform: rotate(45deg);
	}

	/* Popup + map controls themed to tokens so they re-resolve in dark mode (Leaflet defaults the
	   popup wrapper and controls to white — unreadable on the dark basemap otherwise). */
	:global(.leaflet-popup-content-wrapper),
	:global(.leaflet-popup-tip) {
		background: var(--color-bg);
		color: var(--color-ink);
	}
	:global(.leaflet-popup-content-wrapper) {
		border: 1px solid var(--color-border);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
	}
	:global(.leaflet-popup-close-button) {
		color: var(--color-muted) !important;
	}
	:global(.leaflet-bar a) {
		background: var(--color-bg) !important;
		color: var(--color-ink) !important;
		border-bottom-color: var(--color-border) !important;
	}
	:global(.leaflet-bar a:hover) {
		background: var(--color-surface) !important;
	}
	:global(.leaflet-bar a.radius-locate) {
		display: flex;
		align-items: center;
		justify-content: center;
	}
	:global(.leaflet-control-attribution) {
		background: color-mix(in srgb, var(--color-bg) 82%, transparent) !important;
		color: var(--color-muted) !important;
	}
	:global(.leaflet-control-attribution a) {
		color: var(--color-brand) !important;
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
