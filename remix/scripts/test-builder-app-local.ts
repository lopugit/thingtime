// Disposable local integration fixture; refuses every non-loopback origin.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { workspaceAppComposition } from '../app/schemas/workspaceAppComposition';
import { executeBrowserAction } from '../app/components/Actions/browserActionRuntime';
async function main() {
	const origin = process.env.TT_BUILDER_QA_ORIGIN || '';
	const url = new URL(origin);
	if (
		url.protocol !== 'http:' ||
		!['127.0.0.1', 'localhost'].includes(url.hostname) ||
		url.username ||
		url.password ||
		url.pathname !== '/' ||
		url.search ||
		url.hash
	)
		throw new Error('Use an explicit loopback QA origin');
	if (!process.env.TT_BUILDER_QA_SESSION) throw new Error('Set TT_BUILDER_QA_SESSION to the private local fixture session file');
	const qa = JSON.parse(await readFile(process.env.TT_BUILDER_QA_SESSION, 'utf8'));
	const actor = qa.user?.id;
	if (!actor || typeof qa.cookie !== 'string') throw new Error('Invalid QA session');
	const call = async (path: string, body?: any) => {
		const response = await fetch(origin + path, {
			signal: AbortSignal.timeout(path === '/api/v1/things/fork' ? 120000 : 30000),
			method: body ? 'POST' : 'GET',
			headers: { cookie: qa.cookie, 'content-type': 'application/json', origin },
			...(body ? { body: JSON.stringify(body) } : {})
		});
		const bodyText = await response.text();
		let value: any;
		try { value = JSON.parse(bodyText); }
		catch { throw new Error(`${path.split('?')[0]}: ${response.status} returned ${bodyText ? 'non-JSON' : 'empty'} content`); }
		if (!response.ok || value.ok === false) throw new Error(`${path}: ${response.status} ${value.error}`);
		return value;
	};
	const rootId = 'qa-editable-builder-root';
	const pageId = 'qa-editable-builder-page';
	await call('/api/v1/builder/workspaces', { operation: 'initialize', rootId, name: 'Builder app QA', timeZone: 'Australia/Melbourne' });
	const app = workspaceAppComposition({ namespace: 'qa-editable-app', rootId, pagePath: `/p/${pageId}` });
	const ids = new Map<string, string>();
	const upsert = async (id: string, thingtime: string[], crystal: Record<string, unknown>) => {
		const existing = await call('/api/v1/things?id=' + encodeURIComponent(id)).catch(() => null);
		if (existing?.thing) await call('/api/v1/things/update', { id, crystal, replaceCrystal: true, expectedUpdatedAt: existing.thing.updatedAt });
		else await call('/api/v1/things', { shareId: id, acl: ['tt:user'], thingtime, crystal });
	};
	for (const item of app.definitions) {
		const key = item.crystal.actionKey || item.crystal.componentKey;
		const id = 'fixture-' + key;
		await upsert(id, item.thingtime, item.crystal);
		ids.set(key, id);
	}
	const crystal = { name: 'Builder app QA', pageKey: pageId, blocks: app.blocks };
	await upsert(pageId, ['webpage'], crystal);
	await upsert('qa-reference-options', ['action'], {
		name: 'QA reference options',
		actionKey: 'qa-reference-options',
		runtime: 'browser',
		steps: [
			{
				op: 'return',
				value: {
					items: {
						ttExpr: [
							'map',
							{ ttExpr: ['range', 181] },
							{
								id: { ttExpr: ['concat', 'choice-', '$index'] },
								title: { ttExpr: ['concat', 'Choice ', '$index', ' with a long reference label for narrow screen verification'] }
							}
						]
					}
				}
			}
		]
	});
	await upsert('qa-reference-echo', ['action'], {
		name: 'QA reference selection',
		actionKey: 'qa-reference-echo',
		runtime: 'browser',
		inputs: [{ name: 'choice', type: 'string' }],
		steps: [{ op: 'return', value: { message: 'Selected reference', choice: '$input.choice' } }]
	});
	await upsert('qa-reference-component', ['component'], {
		name: 'QA reference picker',
		componentKey: 'qa-reference-component',
		source: { action: 'qa-reference-options' },
		render: {
			tag: 'fieldset',
			children: [
				{ tag: 'tt-select', props: { name: 'choice', title: 'Customer', optionsPath: 'result.items' } },
				{ tag: 'button', props: { type: 'button' }, ttAction: 'qa-reference-echo', children: ['Read selection'] }
			]
		}
	});
	await upsert('qa-reference-page', ['webpage'], {
		name: 'Reference picker QA',
		blocks: [{ id: 'references', type: 'component', component: 'qa-reference-component' }]
	});
	const saved = await call('/api/v1/things?id=qa-reference-component');
	assert.equal(saved.thing.crystal.source.action, 'qa-reference-options');
	await assert.rejects(
		call('/api/v1/actions/run', {
			action: 'qa-editable-app-read',
			inputs: { rootId },
			source: 'component',
			execution: 'browser',
			executionVersion: '1.8.0'
		}),
		/409/
	);
	const prepare = async (action: string, inputs: any) =>
		call('/api/v1/actions/run', { action, inputs, source: 'component', execution: 'browser', executionVersion: '1.10.0' });
	const host = {
		assertIdentity: (id: string) => {
			if (id !== actor) throw new Error('Wrong actor');
		},
		request: async (step: any) =>
			call(step.path + (Object.keys(step.query).length ? '?' + new URLSearchParams(step.query) : ''), step.method === 'GET' ? undefined : step.body),
		prepare
	};
	const run = async (action: string, inputs: any) => executeBrowserAction(await prepare('qa-editable-app-' + action, inputs), host);
	await run('save-customer', {
		rootId,
		id: 'qa-builder-customer',
		firstName: 'QA',
		lastName: 'Customer',
		phone: '0400000000',
		email: 'qa@example.test',
		contact: '',
		description: 'Local disposable fixture'
	});
	const result: any = await run('read', { rootId, view: 'customer' });
	if (process.env.TT_BUILDER_QA_COPY === '1') {
		const copied = await call('/api/v1/things/fork', { id: pageId });
		assert.equal(copied.copied, app.definitions.length + 1);
		const page = (await call('/api/v1/things?id=' + copied.id)).thing;
		const block = page.crystal.blocks[0].children[0];
		assert.equal(block.args.pagePath, '');
		const navigation = (await call('/api/v1/things?id=' + block.component)).thing;
		assert.notEqual(navigation.crystal.source.action, 'qa-editable-app-read');
		const copiedRead: any = await executeBrowserAction(await prepare(navigation.crystal.source.action, { rootId, view: 'customer' }), host);
		assert.ok(copiedRead.records.some((r: any) => r.id === 'qa-builder-customer'));
		console.log({ copiedPage: origin + '/p/' + copied.id, copied: copied.copied, sharedDataRoot: copiedRead.rootId });
	}
	console.log({
		page: origin + '/p/' + pageId,
		definitions: app.definitions.length,
		customers: result.total,
		hasCustomer: result.records.some((r: any) => r.id === 'qa-builder-customer')
	});
}
main().catch((error) => {
	console.error(error.message);
	process.exitCode = 1;
});
