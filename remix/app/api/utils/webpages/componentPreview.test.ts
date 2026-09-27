import assert from 'node:assert/strict';
import test from 'node:test';
import { createDraftComponentsAction } from './componentPreview';
function setup() {
	const state = { owner: 'owner', plane: 'home', limited: false };
	const calls: any[] = [];
	const action = createDraftComponentsAction({
		user: async () => (state.owner ? ({ id: state.owner, username: 'test-owner' } as any) : null),
		plane: () => state.plane,
		limit: async () => ({ allowed: !state.limited, retryAfterSeconds: 3 } as any),
		viewer: async (viewer) => viewer,
		resolve: async (viewer, blocks) => {
			calls.push({ viewer, blocks });
			return { components: [], refs: { missing: null } };
		}
	});
	return { action, state, calls };
}
const blocks = [{ id: 'card', type: 'component', component: 'missing' }];
const request = (body: unknown = { blocks }, query = 'ownerId=owner&dataPlane=home') =>
	new Request(`https://thingtime.test/api/v1/webpages/resolve?${query}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
test('draft component resolution uses only the authenticated viewer and bounded sanitized blocks without a page grant', async () => {
	const h = setup();
	const result = await h.action({ request: request() });
	assert.equal(result.status, 200);
	assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
	assert.deepEqual((await result.json()).refs, { missing: null });
	assert.deepEqual(h.calls, [{ viewer: { id: 'owner', username: 'test-owner' }, blocks }]);
	for (const body of [
		{ blocks, page: { ownerId: 'victim' } },
		{ blocks, ownerId: 'victim' },
		{ blocks: null },
		{ blocks: Array.from({ length: 121 }, (_, i) => ({ id: `item-${i}`, type: 'text', text: 'x' })) },
		{ blocks: [{ id: 'text', type: 'text', text: 'x'.repeat(200 * 1024) }] }
	]) {
		assert.ok([400, 413].includes((await h.action({ request: request(body) })).status));
	}
	assert.equal(h.calls.length, 1);
});
test('draft preview refuses signed-out, switched accounts/databases, missing scope and rate-limited requests before resolving', async () => {
	const h = setup();
	for (const query of ['ownerId=owner', 'dataPlane=home', 'ownerId=owner&dataPlane=home&ownerId=owner', 'ownerId=owner&dataPlane=home&id=page'])
		assert.equal((await h.action({ request: request(undefined, query) })).status, 400);
	h.state.owner = 'other';
	assert.equal((await h.action({ request: request() })).status, 409);
	h.state.owner = 'owner';
	h.state.plane = 'custom';
	assert.equal((await h.action({ request: request() })).status, 409);
	h.state.plane = 'home';
	h.state.limited = true;
	assert.equal((await h.action({ request: request() })).status, 429);
	h.state.owner = '';
	assert.equal((await h.action({ request: request() })).status, 401);
	assert.equal(h.calls.length, 0);
});
