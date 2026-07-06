/**
 * Pure helpers over the router/AP catalog. The catalog itself now lives in the DB
 * (`router_model` table) and is operator-editable from /networks — callers pass the
 * loaded list in (server: from a query; client: from `load` data). No module-level
 * catalog state, so there's nothing to leak across requests on the server.
 *
 * `rangeMeters` is the *advertised / illustrative* outdoor range, not a measured or
 * survey-grade value. The simulator draws plausible-visual coverage, not RSSI.
 */
export interface RouterModel {
	/** Catalog key stored on network_health.model. */
	id: string;
	name: string;
	/** Advertised outdoor range in metres (illustrative). */
	rangeMeters: number;
}

/**
 * Range used only when the catalog is empty (no models at all). Defensive: the
 * catalog is seeded with a baseline row and the UI blocks deleting the last model,
 * so this should never actually be hit — it just keeps `rangeFor` total.
 */
export const FALLBACK_RANGE = 200;

/**
 * The default model id for a catalog = its first entry. Callers pass the list already
 * ordered by `sort_order` (see `listRouterModels`), so "first" is the lowest sortOrder.
 * Empty catalog → '' (and `rangeFor` then uses FALLBACK_RANGE).
 */
export function defaultModelId(models: RouterModel[]): string {
	return models[0]?.id ?? '';
}

/**
 * Advertised range for a model id within `models`; falls back to the default (first)
 * model's range, then FALLBACK_RANGE if the catalog is empty. Unknown/null id → default,
 * so a pin on a deleted model still renders a sane dome.
 */
export function rangeFor(models: RouterModel[], id: string | null | undefined): number {
	const model = (id && models.find((m) => m.id === id)) || models[0];
	return model?.rangeMeters ?? FALLBACK_RANGE;
}
