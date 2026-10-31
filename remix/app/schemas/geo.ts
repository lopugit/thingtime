export type GeoLocation = { lat: number; lng: number };
export type StoredGeoLocation = GeoLocation & { type: 'Point'; coordinates: [number, number] };
export const parseGeo = (value: unknown): StoredGeoLocation | null => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const { lat, lng } = value as GeoLocation;
	if (
		typeof lat !== 'number' ||
		typeof lng !== 'number' ||
		!Number.isFinite(lat) ||
		!Number.isFinite(lng) ||
		Math.abs(lat) > 90 ||
		Math.abs(lng) > 180
	)
		return null;
	// Mongo inspects the leading fields when distinguishing a Point from a legacy coordinate pair.
	return { type: 'Point', coordinates: [lng, lat], lat, lng };
};
export const geoRadiusClause = (point: GeoLocation, radiusKm: number) => ({
	geo: { $geoWithin: { $centerSphere: [[point.lng, point.lat], radiusKm / 6371.0088] } }
});
export const publicGeo = (value: unknown): GeoLocation | null => {
	const parsed = parseGeo(value);
	return parsed ? { lat: parsed.lat, lng: parsed.lng } : null;
};
