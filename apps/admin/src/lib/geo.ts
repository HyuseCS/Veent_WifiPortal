/** Great-circle distance in metres between two coordinates (Haversine). Shared by the map
 * component (cluster eligibility) and the server (assignment validation) so both use the
 * same math. */
export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
	const R = 6371000;
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(bLat - aLat);
	const dLng = toRad(bLng - aLng);
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(h));
}
