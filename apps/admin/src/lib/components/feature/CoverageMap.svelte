<script lang="ts">
	import { onMount } from 'svelte';
	import 'leaflet/dist/leaflet.css';
	import type { NetworkAp } from '$lib/types';

	// Read-only coverage map of every placed access point, status-coloured. Clicking a
	// pin (or selecting a card on the page) focuses that AP. Pins/centre derive purely
	// from `networks` — this view never mutates data.
	let {
		networks,
		selectedId = null,
		onselect
	}: {
		networks: NetworkAp[];
		selectedId?: string | null;
		onselect?: (id: string) => void;
	} = $props();

	// Metro Manila fallback — shown when no APs have coordinates yet.
	const FALLBACK_CENTER: [number, number] = [14.5995, 120.9842];

	// tone → status pin colour (token-backed, so it re-resolves on theme flip).
	const toneColor: Record<string, string> = {
		online: 'var(--color-online)',
		warning: 'var(--color-warning)',
		blocked: 'var(--color-blocked)'
	};

	let mapEl: HTMLDivElement;
	const placed = $derived(networks.filter((n) => n.latitude != null && n.longitude != null));

	let L: typeof import('leaflet') | undefined;
	let map: import('leaflet').Map | undefined;
	let tile: import('leaflet').TileLayer | undefined;
	const markers: Record<string, import('leaflet').Marker> = {};
	let ready = $state(false);

	// CARTO basemap, themed to the admin's light/dark mode.
	function tileUrl(): string {
		const dark = document.documentElement.dataset.theme === 'dark';
		return dark
			? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
			: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png';
	}

	function pinHtml(ap: NetworkAp): string {
		const color = toneColor[ap.tone] ?? 'var(--color-online)';
		const sel = ap.id === selectedId ? ' sel' : '';
		return `<div class="vpin${sel}" style="--c:${color}"><span></span></div>`;
	}

	// (Re)build pins from the placed APs and fit the view to them.
	function renderMarkers() {
		if (!L || !map) return;
		for (const id of Object.keys(markers)) {
			markers[id].remove();
			delete markers[id];
		}
		for (const ap of placed) {
			const icon = L.divIcon({
				className: '',
				html: pinHtml(ap),
				iconSize: [22, 22],
				iconAnchor: [11, 22]
			});
			const m = L.marker([Number(ap.latitude), Number(ap.longitude)], { icon }).addTo(map);
			m.on('click', () => onselect?.(ap.id));
			markers[ap.id] = m;
		}
		if (placed.length) {
			const grp = L.featureGroup(Object.values(markers));
			map.fitBounds(grp.getBounds().pad(0.35));
		}
	}

	// Keep pins in sync with the data once the map exists.
	$effect(() => {
		void placed;
		if (ready) renderMarkers();
	});

	// Highlight + fly to the selected AP whenever the selection changes.
	$effect(() => {
		const id = selectedId;
		if (!ready || !map) return;
		for (const [mid, m] of Object.entries(markers)) {
			const pin = m.getElement()?.querySelector('.vpin');
			pin?.classList.toggle('sel', mid === id);
		}
		const ap = placed.find((a) => a.id === id);
		if (ap) map.flyTo([Number(ap.latitude), Number(ap.longitude)], 18, { duration: 0.7 });
	});

	onMount(() => {
		let cancelled = false;
		let cleanup: (() => void) | undefined;

		(async () => {
			const mod = await import('leaflet');
			if (cancelled) return;
			L = mod.default;

			const m = L.map(mapEl, { zoomControl: true, scrollWheelZoom: false }).setView(
				FALLBACK_CENTER,
				15
			);
			map = m;
			tile = L.tileLayer(tileUrl(), {
				maxZoom: 19,
				subdomains: 'abcd',
				attribution: '&copy; OpenStreetMap, &copy; CARTO'
			}).addTo(m);
			renderMarkers();
			ready = true;
			setTimeout(() => m.invalidateSize(), 200);

			// Swap tiles live when the admin toggles light/dark.
			const obs = new MutationObserver(() => tile?.setUrl(tileUrl()));
			obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
			cleanup = () => obs.disconnect();
		})();

		return () => {
			cancelled = true;
			cleanup?.();
			map?.remove();
		};
	});
</script>

<div bind:this={mapEl} class="h-full w-full"></div>

<style>
	/* Teardrop pin, coloured per status via the inline --c custom property. */
	:global(.vpin) {
		width: 22px;
		height: 22px;
		border-radius: 50% 50% 50% 0;
		transform: rotate(-45deg);
		background: var(--c, var(--color-online));
		border: 2.5px solid #fff;
		box-shadow: 0 2px 7px rgba(10, 21, 80, 0.45);
		position: relative;
		transition: transform 0.15s ease;
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
	:global(.vpin.sel) {
		transform: rotate(-45deg) scale(1.7);
		z-index: 1000 !important;
		box-shadow: 0 5px 18px rgba(10, 21, 80, 0.6);
	}
	:global(.leaflet-container) {
		font-family: var(--font-sans);
		background: var(--color-surface);
	}
	:global(.leaflet-control-zoom a) {
		border-radius: 7px !important;
	}
</style>
