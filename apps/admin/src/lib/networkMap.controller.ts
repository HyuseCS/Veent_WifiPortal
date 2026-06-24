import type { NetworkAp } from '$lib/types';
import { rangeFor } from '$lib/router-models';
import { HEAD_ICON, LOCATE_ICON, LAYERS_ICON, escapeHtml } from '$lib/networkMap';
import { FALLBACK_CENTER, tileUrl, TILE_SUBDOMAINS, TILE_ATTRIBUTION } from '$lib/map';

/**
 * Imperative Leaflet wrapper for NetworkMap.svelte. Owns the map instance, the marker /
 * dome / draggable-pin layers, and the post-drag click suppression — everything that
 * touches Leaflet's mutable DOM. It holds NO app state: the component owns `pins`,
 * `editingApId`, `focusedApId`, etc., passes data into the render methods, and receives
 * Leaflet events back through callbacks. That keeps the reactive state in Svelte and the
 * DOM glue here, instead of one 1300-line component doing both.
 *
 * Not unit-testable (Leaflet needs a real DOM) — verified by a browser pass.
 */

type Leaflet = typeof import('leaflet');

/** Map-level events the controller raises back to the component. */
export interface ControllerCallbacks {
	onReady: () => void;
	onMapClick: (lat: number, lng: number) => void;
	onMarkerFocus: (apId: string) => void;
	onPopupClose: () => void;
	onEditRequest: (ap: NetworkAp) => void;
	onCoverageToggle: (visible: boolean) => void;
}

/** Per-pin events for a draggable placement/edit pin. */
export interface PinLayerCallbacks {
	onDragEnd: (lat: number, lng: number) => void;
	onClick: () => void;
	/** Live coverage radius, read during drag so the sandbox dome tracks the slider. */
	getRange: () => number;
}

export interface RenderDomeOpts {
	coverageVisible: boolean;
	editingApId: string | null;
	focusedApId: string | null;
	clusteredIds: Set<string>;
}

export interface SpawnInit {
	lat: number;
	lng: number;
	range: number;
	apId: string | null;
}

function toneColor(tone: NetworkAp['tone']): string {
	return tone === 'online'
		? 'var(--color-online)'
		: tone === 'warning'
			? 'var(--color-warning)'
			: 'var(--color-blocked)';
}

export class NetworkMapController {
	private L?: Leaflet;
	private map?: import('leaflet').Map;
	/** featureGroup (not layerGroup) so getBounds() works for the fit-to-placed fallback. */
	private markerGroup?: import('leaflet').FeatureGroup;
	private domeGroup?: import('leaflet').LayerGroup;
	private markerById = new Map<string, import('leaflet').Marker>();
	private pinLayers = new Map<
		number,
		{ marker: import('leaflet').Marker; group: import('leaflet').LayerGroup }
	>();
	// Guards against a stray map-click firing right after a marker drag.
	private suppressClick = false;
	private tileObs?: MutationObserver;
	private cancelled = false;
	private cb!: ControllerCallbacks;

	/** Boot the map: tiles, controls, layer groups, and the map-level event wiring. */
	async init(el: HTMLElement, cb: ControllerCallbacks): Promise<void> {
		this.cb = cb;
		const mod = await import('leaflet');
		if (this.cancelled) return;
		const L = mod.default;
		this.L = L;

		const map = L.map(el, { attributionControl: true, zoomControl: false }).setView(
			FALLBACK_CENTER,
			11
		);
		// Dome pane sits above tiles (200) but below markers (600) — default zIndex 400.
		map.createPane('domes');

		L.control.zoom({ position: 'bottomright' }).addTo(map);

		// Re-center on the admin's location. Added after zoom so it stacks just below it
		// (Leaflet lays controls out in add order within a corner).
		const Recenter = L.Control.extend({
			onAdd() {
				const bar = L.DomUtil.create('div', 'leaflet-bar');
				const a = L.DomUtil.create('a', 'radius-locate', bar);
				a.href = '#';
				a.title = 'My location';
				a.setAttribute('role', 'button');
				a.innerHTML = LOCATE_ICON;
				L.DomEvent.on(a, 'click', L.DomEvent.stop).on(a, 'click', () => {
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
		const CoverageToggle = L.Control.extend({
			onAdd: () => {
				let visible = true;
				const bar = L.DomUtil.create('div', 'leaflet-bar');
				const a = L.DomUtil.create('a', 'radius-locate radius-toggle is-active', bar);
				a.href = '#';
				a.title = 'Toggle coverage';
				a.setAttribute('role', 'button');
				a.setAttribute('aria-pressed', 'true');
				a.innerHTML = LAYERS_ICON;
				L.DomEvent.on(a, 'click', L.DomEvent.stop).on(a, 'click', () => {
					visible = !visible;
					a.classList.toggle('is-active', visible);
					a.setAttribute('aria-pressed', String(visible));
					this.cb.onCoverageToggle(visible);
				});
				return bar;
			}
		});
		new CoverageToggle({ position: 'bottomright' }).addTo(map);

		// CARTO basemap, themed to the admin's light/dark mode (mirrors CoverageMap).
		const tileLayer = L.tileLayer(tileUrl(), {
			maxZoom: 19,
			subdomains: TILE_SUBDOMAINS,
			attribution: TILE_ATTRIBUTION
		}).addTo(map);
		this.tileObs = new MutationObserver(() => tileLayer.setUrl(tileUrl()));
		this.tileObs.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-theme']
		});

		this.markerGroup = L.featureGroup().addTo(map);
		this.domeGroup = L.layerGroup().addTo(map);

		// Click empty map → drop a new AP pin (suppressed right after a marker drag).
		map.on('click', (e) => {
			if (!this.suppressClick) this.cb.onMapClick(e.latlng.lat, e.latlng.lng);
		});
		// When the popup is dismissed, restore all domes.
		map.on('popupclose', () => this.cb.onPopupClose());

		this.map = map;
		this.cb.onReady();
	}

	destroy() {
		this.cancelled = true;
		this.tileObs?.disconnect();
		this.map?.remove();
	}

	private vpinIcon(color: string) {
		return this.L!.divIcon({
			className: '',
			html: `<div class="vpin" style="--c:${color}"><span></span></div>`,
			iconSize: [22, 22],
			iconAnchor: [11, 22]
		});
	}

	// Single status-colored circle. Caller owns clearing `group` before redrawing.
	// `overlap` draws a dashed stroke to signal dome intersection; `sandbox` uses the brand
	// color for new/edit pins being placed (not yet saved).
	private drawCircle(
		group: import('leaflet').LayerGroup,
		lat: number,
		lng: number,
		range: number,
		tone = 'online',
		overlap = false,
		sandbox = false
	) {
		const cls = sandbox
			? 'cov-zone-brand'
			: tone === 'online'
				? 'cov-zone-online'
				: tone === 'warning'
					? 'cov-zone-warning'
					: 'cov-zone-offline';
		this.L!.circle([lat, lng], {
			radius: range,
			pane: 'domes',
			stroke: true,
			weight: overlap ? 2 : 1.5,
			dashArray: overlap ? '5 4' : undefined,
			opacity: overlap ? 0.55 : 0.4,
			fillOpacity: 0.08,
			className: cls,
			interactive: false
		}).addTo(group);
	}

	// Markers only — no dome drawing. Keeps open popups alive when only dome state changes.
	// The AP being edited is skipped (its draggable edit pin stands in).
	renderMarkers(placed: NetworkAp[], editingApId: string | null) {
		const L = this.L;
		const group = this.markerGroup;
		if (!L || !group) return;
		group.clearLayers();
		this.markerById.clear();

		for (const ap of placed) {
			if (ap.id === editingApId) continue;
			const lat = Number(ap.latitude);
			const lng = Number(ap.longitude);
			const color = toneColor(ap.tone);

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
			const marker = L.marker([lat, lng], { icon: this.vpinIcon(color) })
				.bindPopup(popup)
				.bindTooltip(tooltip, { direction: 'top', offset: [0, -10], className: 'radius-tip' });
			// Clicking the marker focuses it (hides other domes); popup wires the Edit button.
			marker.on('click', () => this.cb.onMarkerFocus(ap.id));
			marker.on('popupopen', (e) => {
				const btn = e.popup.getElement()?.querySelector('.radius-edit-btn');
				btn?.addEventListener('click', () => {
					this.map?.closePopup();
					this.cb.onEditRequest(ap);
				});
			});
			this.markerById.set(ap.id, marker);
			marker.addTo(group);
		}
	}

	// Domes only — clears and redraws coverage circles without touching markers/popups.
	// Priority: editing (hide all) > focused (only that AP) > all.
	renderDomes(placed: NetworkAp[], opts: RenderDomeOpts) {
		const group = this.domeGroup;
		if (!this.L || !group) return;
		group.clearLayers();
		if (!opts.coverageVisible || opts.editingApId !== null) return;
		for (const ap of placed) {
			if (opts.focusedApId !== null && opts.focusedApId !== ap.id) continue;
			const lat = Number(ap.latitude);
			const lng = Number(ap.longitude);
			const range = ap.rangeMeters ?? rangeFor(ap.model);
			this.drawCircle(group, lat, lng, range, ap.tone, opts.clusteredIds.has(ap.id));
		}
	}

	// Scale the focused pin up (.sel) and restore all others — no marker re-creation.
	applyFocus(focusedApId: string | null) {
		for (const [apId, marker] of this.markerById) {
			marker.getElement()?.querySelector('.vpin')?.classList.toggle('sel', apId === focusedApId);
		}
	}

	// Spawn a draggable pin (new or edit) and its sandbox dome. The component owns the Pin
	// record + localId; this only manages the Leaflet layers and relays drag/click events.
	addPinLayer(localId: number, init: SpawnInit, cb: PinLayerCallbacks) {
		const L = this.L;
		const map = this.map;
		if (!L || !map) return;
		const group = L.layerGroup().addTo(map);
		const marker = L.marker([init.lat, init.lng], {
			icon: this.vpinIcon(init.apId ? 'var(--color-cta)' : 'var(--color-brand)'),
			draggable: true
		}).addTo(map);
		this.drawCircle(group, init.lat, init.lng, init.range, 'online', false, true);
		marker.on('dragstart', () => (this.suppressClick = true));
		marker.on('drag', () => {
			const p = marker.getLatLng();
			group.clearLayers();
			this.drawCircle(group, p.lat, p.lng, cb.getRange(), 'online', false, true);
		});
		marker.on('dragend', () => {
			const p = marker.getLatLng();
			cb.onDragEnd(p.lat, p.lng);
			setTimeout(() => (this.suppressClick = false), 0);
		});
		// Left-click a pin to remove it (suppressClick blocks a post-drag click).
		marker.on('click', () => {
			if (this.suppressClick) return;
			cb.onClick();
		});
		this.pinLayers.set(localId, { marker, group });
	}

	redrawPinLayer(localId: number, range: number) {
		const layer = this.pinLayers.get(localId);
		if (!layer) return;
		const p = layer.marker.getLatLng();
		layer.group.clearLayers();
		this.drawCircle(layer.group, p.lat, p.lng, range, 'online', false, true);
	}

	movePinLayer(localId: number, lat: number, lng: number) {
		this.pinLayers.get(localId)?.marker.setLatLng([lat, lng]);
	}

	removePinLayer(localId: number) {
		const layer = this.pinLayers.get(localId);
		if (layer && this.map) {
			this.map.removeLayer(layer.marker);
			this.map.removeLayer(layer.group);
		}
		this.pinLayers.delete(localId);
	}

	setView(lat: number, lng: number, zoom: number) {
		this.map?.setView([lat, lng], zoom);
	}

	getCenter(): { lat: number; lng: number } | null {
		if (!this.map) return null;
		const c = this.map.getCenter();
		return { lat: c.lat, lng: c.lng };
	}

	// Fit the map to a set of points (e.g. a cluster's members).
	fitBounds(points: [number, number][], pad: number, maxZoom: number) {
		if (!this.L || !this.map || points.length === 0) return;
		this.map.fitBounds(this.L.latLngBounds(points).pad(pad), { maxZoom });
	}

	// Fit to all rendered markers — the no-geolocation fallback.
	fitToMarkers(pad: number) {
		if (!this.map || !this.markerGroup) return;
		const bounds = this.markerGroup.getBounds();
		if (bounds.isValid()) this.map.fitBounds(bounds.pad(pad));
	}
}
