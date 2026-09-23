import test from 'node:test';
import assert from 'node:assert/strict';
import { copyPage } from './copyPage';

test('copy negotiates capability, forwards only the selected root and key, and opens its new private identity', async () => {
	const calls: string[] = [];
	const result = await copyPage({ id: 'source', key: 'link-key' }, { actorId: 'actor', current: () => true, signal: new AbortController().signal }, {
		requireCapability: async (feature, version) => { calls.push(`${feature}:${version}`); },
		fetch: (async (path, init) => {
			calls.push(String(path));
			assert.equal(init?.credentials, 'same-origin');
			assert.equal(new Headers(init?.headers).get('X-Thingtime-Expected-Actor'), 'actor');
			assert.deepEqual(JSON.parse(String(init?.body)), { id: 'source', key: 'link-key' });
			return Response.json({ ok: true, id: 'copied-page' });
		}) as typeof fetch
	});
	assert.deepEqual(calls, ['api.things-fork:1.6.0', 'api.actions-run:1.7.0', '/api/v1/things/fork']);
	assert.equal(result, '/p/copied-page');
});

test('switching account/page before the write prevents copying; switching during it prevents handoff', async () => {
	for (const during of ['capability', 'copy']) {
		let current = true, writes = 0;
		const result = await copyPage({ id: 'source' }, { actorId: 'actor', current: () => current, signal: new AbortController().signal }, {
			requireCapability: async () => { if (during === 'capability') current = false; },
			fetch: (async () => { writes++; current = false; return Response.json({ ok: true, id: 'copied' }); }) as typeof fetch
		});
		assert.equal(result, null);
		assert.equal(writes, during === 'copy' ? 1 : 0);
	}
});

test('copy refuses cancellation, failed permissions and malformed navigation results', async () => {
	const abort = new AbortController(); abort.abort();
	assert.equal(await copyPage({ id: 'source' }, { actorId: 'actor', current: () => true, signal: abort.signal }), null);
	for (const [status, data] of [[403, { ok: false, error: 'Unavailable' }], [200, { ok: true, id: '//elsewhere' }]] as const) {
		await assert.rejects(copyPage({ id: 'source' }, { actorId: 'actor', current: () => true, signal: new AbortController().signal }, {
			requireCapability: async () => {}, fetch: (async () => Response.json(data, { status })) as typeof fetch
		}));
	}
});
