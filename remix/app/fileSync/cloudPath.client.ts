import { CLOUD_PATH_REQUIREMENTS, parseCloudPathObservation } from './cloudPath';
import { cloudRequests, type CloudTransportRuntime } from './cloudTransport';
import { validateSyncScope, validSyncPath, type SyncScope } from './reconcile';

export async function readCloudPathEntry(runtime: CloudTransportRuntime, scope: SyncScope, rootId: string, path: string, signal?: AbortSignal) {
	validateSyncScope(scope);
	if (scope.dataPlane !== 'home' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(rootId) || !validSyncPath(path))
		throw Error('Choose a relative path in a home cloud folder.');
	const { negotiate, json } = cloudRequests(runtime, scope, signal);
	await negotiate(CLOUD_PATH_REQUIREMENTS);
	// A 404 here means the root is unavailable. Only a successful, validated
	// observation with entry:null can establish that the path is absent.
	const result = await json('/api/v1/files?' + new URLSearchParams({ rootId, path }));
	return parseCloudPathObservation(result.observation, rootId, path).entry;
}
