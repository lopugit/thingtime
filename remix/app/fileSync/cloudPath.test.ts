import test from 'node:test';
import assert from 'node:assert/strict';
import { readCloudPathEntry } from './cloudPath.client';

const scope = { origin: 'https://sync.test', ownerId: 'owner', dataPlane: 'home', deviceId: 'device', rootId: 'connection' };
const observation = { version: 1, complete: true, rootId: 'cloud-root', rootRevision: 'r1', path: 'nested/file', entry: null };

test('fresh cloud path absence requires a complete response, home identity and current capability', async () => {
	let current = scope, response = () => Response.json({ ok: true, observation });
	const required: string[] = [];
	const runtime = { currentScope: () => current, origin: () => scope.origin,
		requireCapability: async (feature: string, version: string) => { required.push(feature + '@' + version); },
		fetch: async (url: any, init: any) => {
			assert.equal(new URL(String(url)).searchParams.get('path'), observation.path);
			assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
			assert.equal(init.headers['X-Thingtime-Expected-Actor'], scope.ownerId);
			assert.equal(init.headers['X-Thingtime-Expected-Data-Plane'], 'home');
			return response();
		} };
	const read = () => readCloudPathEntry(runtime, scope, 'cloud-root', observation.path);
	assert.equal(await read(), null);
	assert.deepEqual(required, ['api.files@1.4.0', 'api.actions-run@1.7.0', 'api.mongodb-endpoint@1.1.0']);
	for (const status of [401, 404, 409, 413, 503]) {
		response = () => Response.json({ ok: false }, { status });
		await assert.rejects(read, /Cloud sync request failed/);
	}
	for (const patch of [{ rootId: 'other' }, { path: 'other' }, { complete: false }, { entry: undefined },
		{ entry: { path: observation.path, kind: 'folder', id: 'cloud-root', version: 'v1', size: 0, sha256: null } }]) {
		response = () => Response.json({ ok: true, observation: { ...observation, ...patch } });
		await assert.rejects(read, /complete observation/);
	}
	response = () => { current = { ...scope, ownerId: 'other' }; return Response.json({ ok: true, observation }); };
	await assert.rejects(read, /context changed/);
});
