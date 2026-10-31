import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMobileFolderResult, supportsMobileStaging, supportsMobilePublication } from '../app/fileSync/mobileFolders.client.ts';
import { validSyncEntry } from '../app/fileSync/reconcile.ts';
import type { ThingtimeNativeBridge } from '../app/utils/nativeBridge.ts';

const paths = process.argv.slice(2);
assert.ok(paths.length, 'Pass native staging evidence JSON paths.');
for (const path of paths) {
	const { request, response } = JSON.parse(await readFile(path, 'utf8'));
	assert.equal(validSyncEntry(request.operation.mutation.source), true);
	const result = parseMobileFolderResult(
		response,
		{ requestId: 'android-stage-acceptance', ownerId: request.scope.ownerId, origin: request.scope.origin },
		{ action: 'stage-finish', rootId: request.rootId, transfer: request }
	);
	assert.ok(result?.staging?.stage, 'The native output must pass the production shared codec.');
	assert.equal(result.staging.received, request.operation.mutation.source.size);
	assert.equal(result.staging.stage.operationId, request.operation.id);
	assert.equal(JSON.stringify(response).includes('content://'), false);
}
const bridge: ThingtimeNativeBridge = {
	version: '1.3.0',
	platform: 'android',
	isNativeWebView: true,
	fileAccessVersion: '1.2.0',
	fileStagingVersion: '1.0.0',
	postMessage() { throw Error('The codec check must not dispatch a native request.'); }
};
assert.equal(supportsMobileStaging(bridge), true);
assert.equal(supportsMobilePublication(bridge), false);
console.log(`Validated ${paths.length} Android native staging responses with the shared sync codec.`);
