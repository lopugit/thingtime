import assert from 'node:assert/strict';
import test from 'node:test';

const base = process.env.TT_FUNCTIONAL_TEST_URL;
test('real demo installation preserves customized parts and saves private records', { skip: !base }, async () => {
	assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname), 'Use a local test server');
	let cookie = '';
	const ids = new Set<string>();
	const request = async (path: string, method = 'GET', body?: unknown, authenticated = true) => {
		const response = await fetch(new URL(path, base), {
			method,
			headers: { 'Content-Type': 'application/json', ...(authenticated && cookie ? { Cookie: cookie } : {}) },
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		});
		return { response, data: await response.json() };
	};
	const session = await request('/api/v1/auth/temporary', 'POST');
	assert.ok(session.response.ok, `Test session failed (${session.response.status})`);
	cookie = session.response.headers
		.getSetCookie()
		.map((value) => value.split(';')[0])
		.join('; ');
	assert.ok(cookie);
	const install = async (onlyMissing: boolean) => {
		const { response, data } = await request('/api/v1/webpages/suites/install', 'POST', { key: 'site-forms', onlyMissing });
		assert.equal(response.status, 200, data.error);
		for (const group of ['schemaIds', 'componentIds', 'actionIds', 'pageIds']) for (const id of Object.values(data[group] || {})) ids.add(String(id));
		return data;
	};
	try {
		const installed = await install(true);
		assert.ok(installed.created > 0);
		const page = await request(`/api/v1/things?id=${installed.entryPageId}`);
		const controls = page.data.thing.crystal.blocks.filter((block: any) => block.type === 'component');
		assert.ok(controls.every((block: any) => Object.values(installed.componentIds).includes(block.component)));
		const run = await request('/api/v1/actions/run', 'POST', {
			action: 'demo-site-forms-request',
			source: 'component',
			inputs: { brand: 'Functional fixture', intent: 'Private test request' }
		});
		assert.equal(run.data.status, 'ok', run.data.error);
		const savedId = run.data.result.id;
		assert.ok(savedId);
		ids.add(savedId);
		const saved = await request(`/api/v1/things?id=${savedId}`);
		assert.equal(saved.data.thing.crystal.intent, 'Private test request');
		assert.equal((await request(`/api/v1/things?id=${savedId}`, 'GET', undefined, false)).response.status, 404);
		const actionId = installed.actionIds.request;
		const original = (await request(`/api/v1/things?id=${actionId}`)).data.thing.crystal;
		const customized = { ...original, steps: [{ op: 'return', value: 'My configured integration' }], capabilities: [] };
		assert.equal((await request('/api/v1/things', 'PATCH', { id: actionId, crystal: customized })).response.status, 200);
		const missing = await install(true);
		assert.equal(missing.created, 0);
		assert.equal(missing.updated, 0);
		assert.deepEqual((await request(`/api/v1/things?id=${actionId}`)).data.thing.crystal.steps, customized.steps);
		assert.equal((await install(false)).created, 0);
		assert.deepEqual((await request(`/api/v1/things?id=${actionId}`)).data.thing.crystal.steps, original.steps);
		assert.equal((await request('/api/v1/webpages/suites/install', 'POST', { key: 'site-forms', onlyMissing: 'yes' })).response.status, 400);
	} finally {
		// Exact fixture-created Things only; never discover and delete account data.
		for (const id of ids) {
			const removed = await request(`/api/v1/things?id=${id}`, 'DELETE');
			assert.ok(removed.response.ok, `Could not remove fixture Thing (${removed.response.status})`);
		}
	}
});
