import assert from 'node:assert/strict';
import test from 'node:test';
import { WEB_FEATURES } from './catalogue';
import { executeBrowserAction } from '../components/Actions/browserActionRuntime';

const base = process.env.TT_STANDARDS_TEST_URL;
test('real API installs reusable standards Things idempotently and preserves private ownership', { skip: !base }, async () => {
	assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname), 'Use a disposable local stack');
	let cookie = '';
	const ids = new Set<string>();
	const request = async (path: string, method = 'GET', body?: unknown, authenticated = true, actor?: string) => {
		const response = await fetch(new URL(path, base), {
			method,
			headers: { 'Content-Type': 'application/json', Origin: base!, ...(authenticated && cookie ? { Cookie: cookie } : {}), ...(actor ? { 'X-Thingtime-Expected-Actor': actor } : {}) },
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
		assert.equal(installed.created, 7);
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
		for (const name of ['Node.appendChild', 'HTMLInputElement.setSelectionRange', 'RadioNodeList.value', 'HTMLFormElement.requestSubmit', 'HTMLFormElement.reset', 'ValidityState.tooShort']) {
			const receiverFeature = WEB_FEATURES.find((f) => f.name === name)!;
			const receiverRun = await request('/api/v1/actions/run', 'POST', {
				action: action.id, inputs: { feature: receiverFeature.id, q: name, language: receiverFeature.language }
			});
			assert.equal(receiverRun.data.status, 'ok', receiverRun.data.error);
			const receiverComponent = receiverRun.data.result.selected.component;
			const receiverProgram = receiverComponent.render.children.find((node: any) => node.tag === 'tt-web-platform')?.props.program;
			assert.ok(receiverProgram?.dom?.length || JSON.stringify(receiverProgram).includes('"op":"dom"'));
			assert.equal((await request('/api/v1/things', 'PATCH', { id: saved.data.thing.id, crystal: receiverComponent })).response.status, 200);
			const receiverRead = await request(`/api/v1/things?id=${saved.data.thing.id}`);
			assert.deepEqual(receiverRead.data.thing.crystal.render, receiverComponent.render, `${name} preserves every saved operation and input`);
			assert.equal((await request(`/api/v1/things?id=${saved.data.thing.id}`, 'GET', undefined, false)).response.status, 404);
		}
		const program = {
			version: 1, title: 'Exact saved draft', parameters: [{ name: 'data', label: 'Data', type: 'json', default: [[0, false], [null, '{name}']] }],
			steps: [{ op: 'return', value: { op: 'input', name: 'data' } }]
		};
		const prepare = await request('/api/v1/actions/run', 'POST', {
			action: installed.actionIds['save-draft'], inputs: { program }, source: 'component', execution: 'browser', executionVersion: '1.9.0'
		});
		assert.equal(prepare.data.status, 'prepared', prepare.data.error);
		const actor = prepare.data.viewer.id;
		const result: any = await executeBrowserAction(prepare.data, {
			assertIdentity: id => assert.equal(id, actor),
			prepare: async () => { throw new Error('No nested preparation'); },
			request: async step => {
				const response = await request(step.path, step.method, step.body, true, actor);
				assert.equal(response.response.status, 200, response.data.error);
				if (response.data.thing?.id) ids.add(response.data.thing.id);
				return response.data;
			}
		});
		assert.deepEqual((await request(`/api/v1/things?id=${result.id}`)).data.thing.crystal.render.props.program, program);
		assert.equal((await request(`/api/v1/things?id=${result.id}`, 'GET', undefined, false)).response.status, 404);
		const echo = await request('/api/v1/things', 'POST', {
			thingtime: ['action'], acl: ['tt:user'], crystal: { name: 'JSON API echo fixture', inputs: [{ name: 'value', type: 'json', required: true }], steps: [{ op: 'return', value: '$input.value' }] }
		});
		assert.equal(echo.response.status, 200, echo.data.error); ids.add(echo.data.thing.id);
		for (const value of [null, '', 'null', '123', '{name}', [false, 0, null]]) {
			const run = await request('/api/v1/actions/run', 'POST', { action: echo.data.thing.id, inputs: { value } });
			assert.equal(run.data.status, 'ok', run.data.error); assert.deepEqual(run.data.result, value);
		}
		const parent = await request('/api/v1/things', 'POST', {
			thingtime: ['action'], acl: ['tt:user'], crystal: {
				name: 'JSON child fixture', inputs: [{ name: 'value', type: 'json', required: true }],
				capabilities: [{ capability: 'actions.invoke', actions: [echo.data.thing.id] }],
				steps: [{ op: 'actions.invoke', action: echo.data.thing.id, inputs: { value: '$input.value' } }, { op: 'return', value: '$step.1' }]
			}
		});
		assert.equal(parent.response.status, 200, parent.data.error); ids.add(parent.data.thing.id);
		const nested = await request('/api/v1/actions/run', 'POST', { action: parent.data.thing.id, inputs: { value: 'null' } });
		assert.equal(nested.data.status, 'ok', nested.data.error); assert.equal(nested.data.result, 'null');
		const limited = { ...echo.data.thing.crystal, limits: { maxInputBytes: 100 }, inputs: [{ name: 'value', type: 'json', default: 'x'.repeat(200) }] };
		assert.equal((await request('/api/v1/things', 'PATCH', { id: echo.data.thing.id, crystal: limited })).response.status, 200);
		assert.equal((await request('/api/v1/actions/run', 'POST', { action: echo.data.thing.id, inputs: {} })).response.status, 413, 'Resolved defaults spend the root input budget');
		const oversized = await request('/api/v1/actions/run', 'POST', { action: parent.data.thing.id, inputs: { value: 'x'.repeat(200) } });
		assert.equal(oversized.data.status, 'error'); assert.match(oversized.data.error, /inputs exceed the 100-byte cap/);
	} finally {
		for (const id of ids) assert.ok((await request(`/api/v1/things?id=${id}`, 'DELETE')).response.ok, 'Fixture cleanup failed');
	}
});
