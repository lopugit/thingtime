import test from 'node:test';
import assert from 'node:assert/strict';
import { createBatchHandler } from './_batches';
import { apiEndpointDocs, apiV1DocsRouteKeys, apiV1RouteKeys, createApiCapabilitiesManifest } from '../../../../../docs/apiDocs';
import { thingtimeCapabilityManifest } from '../../../../../api/utils/capabilities/thingtimeCapabilities';
import { capabilitySatisfies } from '../../../../../api/utils/capabilities/capabilityContract';
import { UPLOAD_BATCH_REQUIREMENTS } from '../../../../../fileSync/uploadBatch';
function fixture(account: any = { id: 'owner', accountKind: 'user' }) {
	let calls = 0;
	const action = createBatchHandler({
		user: async () => account,
		service: async () => {
			calls++;
			return { ok: true, version: 1, batchId: 'batch', digest: 'digest', results: [] };
		}
	} as any);
	const request = (body: any = {}, headers: any = {}, signal?: AbortSignal) =>
		new Request('https://sync.test/api/v1/files/batches', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...headers },
			body: JSON.stringify(body),
			signal
		});
	return {
		action,
		request,
		get calls() {
			return calls;
		}
	};
}
test('batch route requires full account, JSON and same origin before service dispatch', async () => {
	for (const user of [null, { id: 'device', accountKind: 'device' }, { id: 'pat', accountKind: 'pat' }]) {
		const f = fixture(user);
		assert.equal((await f.action({ request: f.request() })).status, 401);
		assert.equal(f.calls, 0);
	}
	const f = fixture();
	assert.equal((await f.action({ request: f.request({}, { Origin: 'https://other.test' }) })).status, 403);
	assert.equal((await f.action({ request: f.request({}, { 'Content-Type': 'text/plain' }) })).status, 415);
	assert.equal(f.calls, 0);
	const result = await f.action({ request: f.request() });
	assert.equal(result.status, 200);
	assert.match(result.headers.get('Cache-Control')!, /no-store/);
});
test('batch route caps actual metadata before dispatch and handles cancellation', async () => {
	const f = fixture();
	let result: Response;
	try {
		result = await f.action({ request: f.request({ oversized: 'x'.repeat(512 * 1024) }) });
	} catch (error) {
		result = error as Response;
	}
	assert.equal(result!.status, 413);
	assert.equal(f.calls, 0);
	const controller = new AbortController();
	controller.abort();
	assert.equal((await f.action({ request: f.request({}, {}, controller.signal) })).status, 503);
	assert.equal(f.calls, 0);
});
test('batch route and all three semantic phases belong to the negotiated registry feature', () => {
	const doc = apiEndpointDocs.find((d) => d.id === 'file-sync-batches')!;
	assert.ok(doc);
	assert.deepEqual(doc.methods, ['POST']);
	assert.ok(apiV1RouteKeys.includes('v1/files/batches'));
	assert.ok(apiV1DocsRouteKeys.includes('v1/files/batches-docs'));
	for (const phase of ['observe', 'prepare', 'verify', 'commit','folder-probe','folder-commit']) assert.ok(doc.steps.some((step) => step.includes(`phase=${phase}`)));
	assert.equal(createApiCapabilitiesManifest().features['api.file-sync-batches'], '1.2.0');
	const manifest = thingtimeCapabilityManifest('https://sync.test');
	assert.equal(manifest.features['api.file-sync-batches'].version, '1.2.0');
	assert.ok(
		manifest.operations.some((op) => op.feature === 'api.file-sync-batches' && op.path === '/api/v1/files/batches' && op.methods.includes('POST'))
	);
	for (const version of ['1.0.0', '1.2.0']) assert.equal(capabilitySatisfies(version, UPLOAD_BATCH_REQUIREMENTS['api.file-sync-batches']), true);
	for (const version of ['', '0.9.0', '2.0.0']) assert.equal(capabilitySatisfies(version, UPLOAD_BATCH_REQUIREMENTS['api.file-sync-batches']), false);
});
