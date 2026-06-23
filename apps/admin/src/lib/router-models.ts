/**
 * Router/AP catalog for the coverage simulator. The single source of truth for a
 * model's advertised range — `network_health.model` stores the id (catalog key),
 * not the range, so editing a range here re-sizes every AP's dome automatically.
 *
 * `rangeMeters` is the *advertised / illustrative* outdoor range, not a measured
 * or survey-grade value. The simulator draws plausible-visual coverage, not RSSI.
 */
export interface RouterModel {
	/** Catalog key stored on network_health.model. */
	id: string;
	name: string;
	/** Advertised outdoor range in metres (illustrative). */
	rangeMeters: number;
}

export const routerModels: RouterModel[] = [
	// Wi-Fi 6 outdoor AP, dual high-gain omni. 500 m is the operator's advertised
	// figure (unpublished spec) — a calibration starting point, not a measurement.
	{ id: 'sancom-ap3000g', name: 'Sancom AP3000G', rangeMeters: 500 }
];

/** Fallback model when an AP has no stored model (or an unknown one). */
export const DEFAULT_MODEL_ID = 'sancom-ap3000g';

/** Advertised range for a model id; falls back to the default model's range. */
export function rangeFor(modelId: string | null | undefined): number {
	const byId = (id: string) => routerModels.find((m) => m.id === id);
	const model = (modelId && byId(modelId)) || byId(DEFAULT_MODEL_ID);
	// Catalog is never empty, but guard the lookup chain rather than assert non-null.
	return model?.rangeMeters ?? 0;
}
