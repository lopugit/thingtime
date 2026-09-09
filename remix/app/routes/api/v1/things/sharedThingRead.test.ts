import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharedThingRead } from './sharedThingRead';

const allowed = async () => ({ allowed: true, limit: 240, remaining: 239, resetAt: new Date().toISOString() });

test('shared dependency reads preserve the viewer token/key fence, enrich audiences and never cache', async () => {
	const viewer = { id: 'reader', pat: { tokenId: 'token', onlyCreatedThings: true, visibility: 'hidden' as const }, linkKeys: new Set(['fixture-key']) };
	const read = createSharedThingRead({
		limit: allowed,
		enrich: async (input) => ({ ...input!, groupIds: new Set(['group']) }),
		read: async (input, id, root) => {
			assert.equal(input?.id, viewer.id);
			assert.deepEqual(input?.pat, viewer.pat);
			assert.deepEqual(input?.linkKeys, viewer.linkKeys);
			assert.ok(input?.groupIds?.has('group'));
			assert.equal(id, 'schema'); assert.equal(root, 'root');
			return { ok: true, thing: { id } as any };
		}
	});
	const result = await read(new Request('https://thingtime.test/api/v1/things?id=schema&sharedRoot=root'), { viewer, app: false, cors: {} });
	assert.equal(result.status, 200);
	assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
	assert.equal(result.headers.get('Referrer-Policy'), 'no-referrer');
	assert.equal((await result.json()).thing.id, 'schema');
});

test('app tokens and shared-context listing or malformed ids fail before dependency reads', async () => {
	const read = createSharedThingRead({ read: async () => { throw Error('must not read'); }, limit: async () => { throw Error('must not consume'); } });
	for (const [query, app, status] of [['id=child&sharedRoot=root', true, 403], ['sharedRoot=root', false, 400], ['id=child&sharedRoot=', false, 400], [`id=child&sharedRoot=${'a'.repeat(129)}`, false, 400]] as const) {
		const result = await read(new Request(`https://thingtime.test/api/v1/things?${query}`), { viewer: null, app, cors: { 'Access-Control-Allow-Origin': 'https://client.test' } });
		assert.equal(result.status, status);
		assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
		assert.equal(result.headers.get('Access-Control-Allow-Origin'), 'https://client.test');
	}
});

test('rate denial and root revocation return non-cacheable failures', async () => {
	for (const denied of [true, false]) {
		const read = createSharedThingRead({
			limit: async () => ({ ...(await allowed()), allowed: !denied }),
			enrich: async (viewer) => viewer,
			read: async () => ({ ok: false, status: 404, error: 'Shared dependency not found' })
		});
		const result = await read(new Request('https://thingtime.test/api/v1/things?id=child&sharedRoot=root'), { viewer: null, app: false, cors: {} });
		assert.equal(result.status, denied ? 429 : 404);
		assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
	}
});
