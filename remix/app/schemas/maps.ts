export const MAPS_FEATURE = 'api.maps';
export const MAPS_FEATURE_VERSION = '1.0.0';
export const MAPBOX_PROFILES = ['driving', 'driving-traffic', 'walking', 'cycling'] as const;
export type MapboxProfile = (typeof MAPBOX_PROFILES)[number];
export type MapCoordinate = [number, number];
export type MapStop = { id: string; coordinates: MapCoordinate };
export const MAPBOX_NAVIGATION_CACHE_POLICY = 'transient' as const;
