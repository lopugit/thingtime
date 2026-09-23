import assert from 'node:assert/strict';
import test from 'node:test';
import { WEB_FEATURES } from './catalogue';

const base = process.env.TT_STANDARDS_TEST_URL;
test('real API installs reusable standards Things idempotently and preserves private ownership', { skip: !base }, async () => {
	assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname), 'Use a disposable local stack');
	let cookie = '';
	const ids = new Set<string>();
	const request = async (path: string, method = 'GET', body?: unknown, authenticated = true) => {
		const response = await fetch(new URL(path, base), {
			method,
			headers: { 'Content-Type': 'application/json', Origin: base!, ...(authenticated && cookie ? { Cookie: cookie } : {}) },
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		});
		return { response, data: await response.json() };
	};
	const health = await request('/api/v1/health/mongodb');
	assert.equal(health.data.host, process.env.TT_STANDARDS_TEST_DATABASE_HOST, 'Explicit disposable database host must match');
	const session = await request('/api/v1/auth/temporary', 'POST');
	assert.ok(session.response.ok, `Session: ${session.response.status}`);
	cookie = session.response.headers
		.getSetCookie()
		.map((value) => value.split(';')[0])
		.join('; ');
	assert.ok(cookie);
	const install = async () => {
		const { response, data } = await request('/api/v1/webpages/suites/install', 'POST', { key: 'web-standards', onlyMissing: true });
		assert.equal(response.status, 200, data.error);
		for (const group of ['schemaIds', 'componentIds', 'actionIds', 'pageIds']) for (const id of Object.values(data[group] || {})) ids.add(String(id));
		return data;
	};
	try {
		const installed = await install();
		assert.equal(installed.created, 6);
		const again = await install();
		assert.equal(again.created, 0);
		assert.equal(again.updated, 0);
		const feature = WEB_FEATURES.find((f) => f.language === 'html' && f.name === 'dialog')!;
		const action = (await request(`/api/v1/things?id=${installed.actionIds.catalogue}`)).data.thing;
		const run = await request('/api/v1/actions/run', 'POST', { action: action.id, inputs: { feature: feature.id, q: 'dialog', language: 'html' } });
		assert.equal(run.data.status, 'ok', run.data.error);
		assert.ok(run.data.result.cards.some((card: any) => card.id === feature.id));
		assert.ok(run.data.result.cards.every((card: any) => card.language === 'html'));
		const component = run.data.result.selected.component;
		assert.ok(JSON.stringify(component.render).includes('showModal'));
		const saved = await request('/api/v1/things', 'POST', { thingtime: ['component'], acl: ['tt:user'], crystal: component });
		assert.equal(saved.response.status, 200, saved.data.error);
		ids.add(saved.data.thing.id);
		const read = await request(`/api/v1/things?id=${saved.data.thing.id}`);
		assert.deepEqual(read.data.thing.crystal.render, component.render);
		for (const id of [saved.data.thing.id, installed.entryPageId]) {
			assert.equal((await request(`/api/v1/things?id=${id}`, 'GET', undefined, false)).response.status, 404);
		}
		assert.equal(
			(await request('/api/v1/things', 'PATCH', { id: saved.data.thing.id, crystal: { ...component, name: 'Updated private example' } })).response
				.status,
			200
		);
	} finally {
		for (const id of ids) assert.ok((await request(`/api/v1/things?id=${id}`, 'DELETE')).response.ok, 'Fixture cleanup failed');
	}
});
