<script lang="ts">
	import { onMount } from 'svelte';
	import 'leaflet/dist/leaflet.css';
	import type { NetworkAp } from '$lib/types';
	import { FALLBACK_CENTER, tileUrl, TILE_SUBDOMAINS, TILE_ATTRIBUTION } from '$lib/map';

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

	// tone → status pin colour (token-backed, so it re-resolves on theme flip).
	const toneColor: Record<string, string> = {
		online: 'var(--color-online)',
		warning: 'var(--color-warning)',
		blocked: 'var(--color-blocked)'
	};
	const toneLabel: Record<string, string> = {
		online: 'Healthy',
		warning: 'Degraded',
		blocked: 'Offline'
	};

	function escapeHtml(s: string): string {
		return s
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	function popupHtml(ap: NetworkAp): string {
		const color = toneColor[ap.tone] ?? 'var(--color-online)';
		const label = toneLabel[ap.tone] ?? ap.tone;
		return `<div style="font-family:var(--font-sans);color:var(--color-ink);min-width:9rem;">
			<div style="font-size:.875rem;font-weight:700;letter-spacing:-.01em;">${escapeHtml(ap.name)}</div>
			${ap.address ? `<div style="font-size:.75rem;color:var(--color-muted);margin-top:.125rem;">${escapeHtml(ap.address)}</div>` : ''}
			<div style="display:flex;align-items:center;gap:.375rem;margin-top:.5rem;font-size:.8125rem;font-weight:700;color:${color};">
				<span style="display:inline-block;width:.5rem;height:.5rem;border-radius:9999px;background:${color};flex:none;"></span>${label}
			</div>
			<div style="display:flex;align-items:center;gap:.375rem;margin-top:.25rem;font-size:.8125rem;font-weight:600;color:var(--color-ink);">
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>${ap.users} active
			</div>
		</div>`;
	}

	let mapEl: HTMLDivElement;
	const placed = $derived(networks.filter((n) => n.latitude != null && n.longitude != null));

	let L: typeof import('leaflet') | undefined;
	let map: import('leaflet').Map | undefined;
	let tile: import('leaflet').TileLayer | undefined;
	const markers: Record<string, import('leaflet').Marker> = {};
	let ready = $state(false);

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
			m.bindPopup(popupHtml(ap), { offset: [0, -14], closeButton: true });
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
		if (ap && id) {
			map.flyTo([Number(ap.latitude), Number(ap.longitude)], 18, { duration: 0.7 });
			const mk = markers[id];
			if (mk) map.once('moveend', () => mk.openPopup());
		}
	});

	onMount(() => {
		let cancelled = false;
		let cleanup: (() => void) | undefined;

		(async () => {
			const mod = await import('leaflet');
			if (cancelled) return;
			L = mod.default;

			const m = L.map(mapEl, { zoomControl: false, scrollWheelZoom: false }).setView(
				FALLBACK_CENTER,
				15
			);
			L.control.zoom({ position: 'bottomright' }).addTo(m);
			map = m;
			tile = L.tileLayer(tileUrl(), {
				maxZoom: 19,
				subdomains: TILE_SUBDOMAINS,
				attribution: TILE_ATTRIBUTION
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

