import { distanceMeters } from '$lib/geo';

/**
 * Coverage-reach primitives — the single source of truth for "are two APs within
 * coverage of each other". Used by client-side clustering (`$lib/clustering`), the
 * map sidebar's join checks, and the server's cluster join guard
 * (`map/+page.server.ts`), so all three agree on the same math instead of each
 * re-deriving `distance < sum-of-ranges` and drifting apart.
 */

/** Two coverage domes overlap when their centres are closer than the sum of radii. */
export function domesOverlap(
	aLat: number,
	aLng: number,
	aRange: number,
	bLat: number,
	bLng: number,
	bRange: number
): boolean {
	return distanceMeters(aLat, aLng, bLat, bLng) < aRange + bRange;
}

/** A coverage dome: a centre and its radius in metres. */
export interface Dome {
	lat: number;
	lng: number;
	range: number;
}

/** True if a dome at (lat,lng,range) overlaps any member dome. Empty list → false.
 * Callers that treat "no members" as allowed (e.g. seeding a fresh cluster) handle
 * that case themselves before calling this. */
export function reachesAny(lat: number, lng: number, range: number, members: Dome[]): boolean {
	return members.some((m) => domesOverlap(lat, lng, range, m.lat, m.lng, m.range));
}
