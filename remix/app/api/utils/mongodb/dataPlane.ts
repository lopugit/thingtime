import { createHash } from 'node:crypto';
import { getMongoUri, sanitiseMongoHost } from './config';
import { dbNameFromMongoUrl, getActiveMongoEndpoint, type MongoEndpointSelection } from './endpoint';
import { EXPECTED_DATA_PLANE_HEADER, isDataPlane } from '../../../utils/dataPlane';

export function mongoDataPlane(selection: MongoEndpointSelection | null = getActiveMongoEndpoint()): string {
	if (!selection) return 'home';
	try { if (selection.url === getMongoUri()) return 'home'; } catch { /* A configured custom database may be the only available source. */ }
	// Hash only the public location, never credentials (which would create a password oracle).
	return `custom-${createHash('sha256').update(JSON.stringify([sanitiseMongoHost(selection.url), dbNameFromMongoUrl(selection.url)])).digest('hex')}`;
}

/** An identity precondition, never a routing instruction or authorization grant. */
export function enforceExpectedDataPlane(request: Request, selection: MongoEndpointSelection | null) {
	const expected = request.headers.get(EXPECTED_DATA_PLANE_HEADER);
	if (expected === null) return null;
	const invalid = !isDataPlane(expected);
	if (!invalid && expected === mongoDataPlane(selection)) return null;
	return Response.json({ ok: false, code: invalid ? 'INVALID_DATA_PLANE' : 'DATA_PLANE_CHANGED', error: invalid ? 'Invalid expected database' : 'The database selection changed. Reopen this Thing before continuing.' }, {
		status: invalid ? 400 : 409, headers: { 'Cache-Control': 'private, no-store', Vary: `Cookie, Authorization, x-tt-mongo-url, ${EXPECTED_DATA_PLANE_HEADER}` }
	});
}
