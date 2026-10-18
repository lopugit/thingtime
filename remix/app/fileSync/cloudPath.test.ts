import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';
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
	assert.deepEqual(required, ['api.files@1.6.0', 'api.actions-run@1.7.0', 'api.mongodb-endpoint@1.1.0']);
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


test('wide-folder clients negotiate the selected origin before requesting path data', async () => {
 for (const [version, accepted] of [[undefined, false], ['1.5.9', false], ['1.6.0', true], ['1.6.1', true], ['1.7.0', true], ['2.0.0', false]] as const) {
  let requests = 0;
  const read = () => readCloudPathEntry({ currentScope: () => scope, origin: () => scope.origin,
   requireCapability: async (feature, minimum) => {
    if (feature === 'api.files' && !capabilitySatisfies(version, minimum)) throw Error('Unsupported path capability');
   }, fetch: async () => { requests++; return Response.json({ ok: true, observation }); }
  }, scope, 'cloud-root', observation.path);
  if (accepted) assert.equal(await read(), null); else await assert.rejects(read, /Unsupported path capability/);
  assert.equal(requests, accepted ? 1 : 0);
 }
});
