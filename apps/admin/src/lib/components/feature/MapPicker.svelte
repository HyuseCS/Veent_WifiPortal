<script lang="ts">
	import { onMount } from 'svelte';
	import 'leaflet/dist/leaflet.css';
	import { FALLBACK_CENTER, tileUrl, TILE_SUBDOMAINS, TILE_ATTRIBUTION } from '$lib/map';

	// Embeddable coordinate picker: click the map (or drag the pin) to set lat/lng.
	// Both are two-way so the parent reads the chosen spot. Mount this only while
	// visible (e.g. inside an open dialog) so leaflet measures a laid-out container.
	let {
		lat = $bindable(null),
		lng = $bindable(null),
		height = 'h-64',
		autolocate = true,
		onpick
	}: {
		lat?: number | null;
		lng?: number | null;
		height?: string;
		/** Center on the operator's GPS for a fresh pick. Off for tiled mini-maps so
		 *  N cards don't each fire a geolocation request. */
		autolocate?: boolean;
		onpick?: (coords: { lat: number; lng: number }) => void;
	} = $props();

	let mapEl: HTMLDivElement;

	onMount(() => {
		let cancelled = false;
		let cleanup: (() => void) | undefined;

		(async () => {
			const L = (await import('leaflet')).default;
			if (cancelled) return;

			const seeded = lat != null && lng != null;
			const map = L.map(mapEl, { zoomControl: false, scrollWheelZoom: false }).setView(
				seeded ? [lat as number, lng as number] : FALLBACK_CENTER,
				seeded ? 16 : 12
			);
			L.control.zoom({ position: 'bottomright' }).addTo(map);
			const tileLayer = L.tileLayer(tileUrl(), {
				maxZoom: 19,
				subdomains: TILE_SUBDOMAINS,
				attribution: TILE_ATTRIBUTION
			}).addTo(map);

			// Swap tiles live when the admin toggles light/dark.
			const obs = new MutationObserver(() => tileLayer.setUrl(tileUrl()));
			obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

			const pinIcon = (L: typeof import('leaflet')) =>
				L.divIcon({
					className: '',
					html: '<div class="vpick"><span></span></div>',
					iconSize: [22, 22],
					iconAnchor: [11, 22]
				});

			let marker: import('leaflet').Marker | undefined;
			const setPin = (la: number, lo: number) => {
				lat = la;
				lng = lo;
				onpick?.({ lat: la, lng: lo });
				if (marker) {
					marker.setLatLng([la, lo]);
				} else {
					const mk = L.marker([la, lo], { draggable: true, icon: pinIcon(L) }).addTo(map);
					mk.on('dragend', () => {
						const p = mk.getLatLng();
						lat = p.lat;
						lng = p.lng;
					});
					marker = mk;
				}
			};

			if (seeded) setPin(lat as number, lng as number);
			map.on('click', (e) => setPin(e.latlng.lat, e.latlng.lng));

			// The container often lays out (dialog open / details expand) after this
			// runs — leaflet measured 0×0, so re-measure once it's visible.
			setTimeout(() => map.invalidateSize(), 60);

			// Only auto-locate when asked and there's no existing pin to preserve.
			if (autolocate && !seeded && navigator.geolocation) {
				navigator.geolocation.getCurrentPosition(
					(pos) => {
						if (!cancelled) map.setView([pos.coords.latitude, pos.coords.longitude], 15);
					},
					() => {},
					{ enableHighAccuracy: false, timeout: 6000 }
				);
			}

			cleanup = () => {
				obs.disconnect();
				map.remove();
			};
		})();

		return () => {
			cancelled = true;
			cleanup?.();
		};
	});
</script>

<div
	bind:this={mapEl}
	class="{height} w-full overflow-hidden rounded-md border border-border bg-surface"
></div>

