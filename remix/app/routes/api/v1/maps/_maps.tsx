import { mapboxBrowserConfig, mapboxGeocode, mapboxOptimize, MapsError } from '~/api/utils/maps/mapbox';
import { mapRoute } from '~/api/utils/maps/route';

// One owner-scoped capability endpoint. Each operation has its own strict
// provider contract; no caller-supplied URL, header or arbitrary request path.
export const mapOperation = (ownerId: string, input: any, signal: AbortSignal) => {
	switch (input?.operation) {
		case 'suggest': return mapboxGeocode(ownerId, input, fetch, undefined, signal);
		case 'optimize': return mapboxOptimize(ownerId, input, fetch, undefined, signal);
		case 'browser-config': return mapboxBrowserConfig(ownerId, input);
		default: throw new MapsError(400, 'Choose a supported map operation.');
	}
};
export const action = ({ request }: { request: Request }) => mapRoute(request, mapOperation);
