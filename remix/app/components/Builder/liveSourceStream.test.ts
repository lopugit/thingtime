import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CHARACTER_HEADER } from '~/components/Characters/CharacterScope';
import { EXPECTED_DATA_PLANE_HEADER } from '~/utils/dataPlane';
import { buildLiveSourceRequest, consumeLiveSourceStream, validateLiveSourceStream } from './liveSourceStream';

const allowed = { path: '/api/v1/agent-overview', feature: 'api.agent-overview', minimumVersion: '2.0.0' };

test('live sources require an allowlisted capability binding', () => {
	assert.equal(validateLiveSourceStream(allowed), true);
	assert.equal(validateLiveSourceStream({ ...allowed, path: '/api/v1/things' }), false);
	assert.equal(validateLiveSourceStream({ ...allowed, feature: 'api.other' }), false);
	assert.equal(validateLiveSourceStream({ ...allowed, minimumVersion: 'latest' }), false);
});

test('live request carries auth context in headers and source inputs in the query', () => {
	const request = buildLiveSourceRequest({
		path: allowed.path,
		inputs: { view: 'tasks', taskId: 'task 1', enabled: true, omitted: null, nested: { secret: 'never' } },
		dataPlane: 'home',
		characterId: 'char-1'
	});
	assert.equal(request.url, '/api/v1/agent-overview?view=tasks&taskId=task+1&enabled=true&stream=1');
	assert.equal(request.init.credentials, 'include');
	assert.equal(request.init.headers[EXPECTED_DATA_PLANE_HEADER], 'home');
	assert.equal(request.init.headers[CHARACTER_HEADER], 'char-1');
	assert.equal(request.init.headers.Accept, 'text/event-stream');
	assert.throws(() => buildLiveSourceRequest({ path: `${allowed.path}?token=secret`, inputs: {}, dataPlane: 'home' }));
	assert.throws(() => buildLiveSourceRequest({ path: '//evil.example/api/v1/agent-overview', inputs: {}, dataPlane: 'home' }));
});

test('live stream emits raw JSON snapshot events and closes reader', async () => {
	let cancelled = false;
	const abort = new AbortController();
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(': heartbeat\r\nevent: snapshot\r\ndata: {"tasks":[1,2]}\r\n\r\n'));
		},
		cancel() { cancelled = true; }
	});
	const snapshots: unknown[] = [];
	await consumeLiveSourceStream({
		path: allowed.path,
		inputs: {},
		dataPlane: 'home',
		signal: abort.signal,
		fetcher: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
		onSnapshot: (value) => { snapshots.push(value); abort.abort(); },
		onForbidden: () => assert.fail('unexpected revocation')
	});
	assert.deepEqual(snapshots, [{ tasks: [1, 2] }]);
	assert.equal(cancelled, true);
});

test('unauthorized and changed-data-plane responses revoke the cached result path', async () => {
	for (const status of [401, 403, 404, 409]) {
		let forbidden = false;
		await assert.rejects(() => consumeLiveSourceStream({
			path: allowed.path,
			inputs: {},
			dataPlane: 'home',
			signal: new AbortController().signal,
			fetcher: async () => new Response(null, { status }),
			onSnapshot: () => assert.fail('unexpected snapshot'),
			onForbidden: () => { forbidden = true; }
		}), error => (error as any).terminal === true && /access is no longer available/.test((error as Error).message));
		assert.equal(forbidden, true);
	}
});
