import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMobileFolderResult } from '../app/fileSync/mobileFolders.client.ts';
import { sameSyncContent } from '../app/fileSync/reconcile.ts';

const paths = process.argv.slice(2);
assert.ok(paths.length, 'Pass native managed-publication evidence JSON paths.');
for (const path of paths) {
	const { request, response } = JSON.parse(await readFile(path, 'utf8'));
	const result = parseMobileFolderResult(response,
		{ requestId: 'android-managed-acceptance', ownerId: request.scope.ownerId, origin: request.scope.origin },
		{ action: 'publication-lookup', rootId: request.rootId, transfer: request });
	assert.equal(result?.publication?.status, 'complete');
	const publication = result?.publication;
	assert.ok(publication && publication.status === 'complete');
	assert.ok(publication.receipt.entry);
	assert.equal(sameSyncContent(publication.receipt.entry, request.operation.mutation.source), true);
	assert.equal(JSON.stringify(response).includes('content://'), false);
	assert.equal(JSON.stringify(response).includes('/data/'), false);
}
console.log(`Validated ${paths.length} Android native publication receipts with the production shared codec.`);
