/**
 * Forward geocoding for the NetworkMap (address → coordinates). Isolated here so it's
 * the single external-geocoder boundary: one place to mock in tests and one place to
 * swap providers.
 *
 * ponytail: Nominatim public geocoder — usage policy is ~1 req/sec, no API key, and it's
 * only hit on explicit submit/Locate (no typeahead), so we stay well under it. Swap for a
 * keyed/self-hosted geocoder before heavy prod use.
 */

export interface GeoHit {
	lat: number;
	lng: number;
	label: string;
}

export async function geocode(q: string): Promise<GeoHit | null> {
	const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
	try {
		const res = await fetch(url, { headers: { Accept: 'application/json' } });
		if (!res.ok) return null;
		const data = await res.json();
		if (!Array.isArray(data) || data.length === 0) return null;
		return {
			lat: Number(data[0].lat),
			lng: Number(data[0].lon),
			label: String(data[0].display_name ?? q)
		};
	} catch {
		return null;
	}
}
