/**
 * Shared types + pure helpers for the NetworkMap feature, split out so the component
 * (`NetworkMap.svelte`), the pin editor (`PinPanel.svelte`), and the Leaflet controller
 * (`networkMap.controller.ts`) all agree on one `Pin` shape and reuse the same icon
 * markup / HTML escaping instead of each re-declaring them.
 */

/**
 * A draggable map pin. apId null = a brand-new AP (posts ?/addPlace); apId set = an
 * in-place edit of an existing AP (posts ?/updatePlace, can Remove). lat/lng mirror the
 * marker, synced on drag-end, so the save form persists where the pin landed.
 */
export interface Pin {
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

/** Escape user text before interpolating into a Leaflet popup's innerHTML. */
export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// Inline lucide "user" head — used in the marker hover tooltip and click popup.
export const HEAD_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

// Inline lucide "locate-fixed" — the re-center control's glyph (Leaflet controls are
// raw HTML, so it can't be a Svelte component).
export const LOCATE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/></svg>`;

// Inline lucide "layers" — the coverage-toggle control's glyph.
export const LAYERS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>`;
