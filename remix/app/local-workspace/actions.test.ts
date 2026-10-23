import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { WorkspaceDatabase } from './storage';
import { LocalThings } from './things';
import { LocalActions } from './actions';
const scope = { kind: 'anonymous' as const },
	lease = { assertCurrent() {}, onInvalidate: () => () => {} };
const fixture = () => {
	const db = new WorkspaceDatabase(new IDBFactory());
	return { db, things: new LocalThings(db, scope, lease), actions: new LocalActions(db, scope, lease) };
};
const definition = (steps: unknown[], capabilities: unknown[] = [], extra = {}) => ({
	thingtime: ['action'],
	crystal: { name: 'Local Action', actionKey: 'local-test-action', version: 1, inputs: [], steps, capabilities, ...extra }
});

test('canonical local Action creates, searches, updates and reads Data with scoped schemas and default inputs', async () => {
	const { db, things, actions } = fixture();
	try {
		const schema = await things.create({ thingtime: ['schema'], crystal: { name: 'local-note', fields: [{ name: 'text', type: 'string' }] } });
		const program = await things.create(
			definition(
				[
					{ op: 'things.create', schema: 'local-note', values: { text: '$input.text' } },
					{ op: 'things.search', schema: 'local-note', match: { text: 'HELLO' } },
					{ op: 'things.update', id: '$step.1.id', values: { text: 'Updated', schema: 'forged', schemaId: 'foreign' } },
					{ op: 'things.get', id: '$step.1.id' },
					{ op: 'return', value: { created: '$step.1', matches: '$step.2', updated: '$step.4' } }
				],
				['things.create', 'things.read', 'things.update'].map((capability) => ({ capability, schemas: ['local-note'] })),
				{ inputs: [{ name: 'text', type: 'string', default: 'Hello local' }] }
			)
		);
		const result = await actions.run({ action: program.id });
		assert.equal(result.status, 'ok', result.error);
		const value = result.result as any;
		assert.equal(value.created.crystal.text, 'Hello local');
		assert.equal(value.matches.length, 1);
		assert.equal(value.updated.crystal.text, 'Updated');
		assert.equal(value.updated.crystal.schemaId, schema.id);
		assert.equal(value.updated.crystal.schema, 'local-note');
		assert.equal(result.opsUsed, 4);
		const history = await actions.runs({ action: program.id });
		assert.equal(history.runs.length, 1);
		assert.equal(history.runs[0].status, 'ok');
		assert.equal(
			(await things.list()).things.some((row) => row.thingtime.includes('action-run')),
			false
		);
		await assert.rejects(things.get(result.runId), /not in this workspace/);
		const exported = await things.export([program.id]);
		assert.equal(
			exported.manifest.things.some((row) => row.thingtime.includes('action-run')),
			false
		);
		await assert.rejects(things.export([result.runId]), /run state/);
		await things.remove([program.id]);
		assert.equal((await actions.runs()).runs.length, 0);
	} finally {
		await db.close();
	}
});

test('nested local programs preserve the canonical expression, input and shared-budget contracts', async () => {
	const { db, things, actions } = fixture();
	try {
		await things.create(
			definition([{ op: 'return', value: { ttExpr: ['mul', '$input.n', 2] } }], [], {
				actionKey: 'double',
				inputs: [{ name: 'n', type: 'number', required: true }]
			})
		);
		const root = await things.create(
			definition(
				[
					{ op: 'each', list: [1, 2, 3], action: 'double', inputs: { n: '$item' } },
					{ op: 'return', value: '$step.1' }
				],
				[{ capability: 'actions.invoke', actions: ['double'] }]
			)
		);
		const run = await actions.run({ action: root.id });
		assert.equal(run.status, 'ok', run.error);
		assert.deepEqual(run.result, [2, 4, 6]);
		await assert.rejects(actions.run({ action: 'double', inputs: { n: 'bad' } }), /number/);
		await things.update({ id: root.id, crystal: { limits: { maxChildActions: 1 } } });
		assert.match((await actions.run({ action: root.id })).error || '', /budget exhausted/);
		const newer = await things.create(definition([{ op: 'return', value: false }], [], { actionKey: 'double', version: 2 }));
		assert.equal((await actions.run({ action: 'double' })).actionId, newer.id);
		assert.equal((await actions.run({ action: 'double' })).result, false);
	} finally {
		await db.close();
	}
});

test('local Actions refuse remote authority, unavailable services and non-Data targets without fallback', async () => {
	const { db, things, actions } = fixture();
	const original = globalThis.fetch;
	let requests = 0;
	globalThis.fetch = async () => {
		requests++;
		throw new Error('unexpected network');
	};
	try {
		const program = await things.create(definition([{ op: 'things.get', id: 'private-account-id' }], [{ capability: 'things.read' }]));
		assert.match((await actions.run({ action: program.id })).error || '', /not in this workspace/);
		await things.update({ id: program.id, crystal: { steps: [{ op: 'things.get', id: program.id }] } });
		assert.match((await actions.run({ action: program.id })).error || '', /not a data thing/);
		await things.update({ id: program.id, crystal: { steps: [{ op: 'things.search', scope: 'public', schema: 'anything' }] } });
		assert.match((await actions.run({ action: program.id })).error || '', /online service/);
		const browser = await things.create(
			definition(
				[{ op: 'http.request', path: '/api/v1/vault', method: 'GET', feature: 'api.vault', minimumVersion: '1.0.0' }],
				[{ capability: 'http.request', endpoints: ['GET /api/v1/vault'] }],
				{ runtime: 'browser', actionKey: 'browser-test' }
			)
		);
		assert.match((await actions.run({ action: browser.id })).error || '', /local adapter/);
		await things.update({ id: browser.id, crystal: { steps: [{ op: 'return', value: { original: true } }] } });
		assert.deepEqual((await actions.run({ action: browser.id })).result, { original: true });
		await assert.rejects(actions.run({ action: 'foreign-action' }), /No action you own/);
		const retired = new LocalActions(db, scope, {
			...lease,
			assertCurrent() {
				throw new Error('Workspace changed');
			}
		});
		await assert.rejects(retired.run({ action: program.id }), /Workspace changed/);
		assert.equal(requests, 0);
	} finally {
		globalThis.fetch = original;
		await db.close();
	}
});

test('search keeps missing-input equality filters and cannot escape its schema scope', async () => {
	const { db, things, actions } = fixture();
	try {
		for (const name of ['one', 'two']) await things.create({ thingtime: ['schema'], crystal: { name, fields: [] } });
		await things.create({ thingtime: ['data'], crystal: { schema: 'one', text: 'not null' } });
		const empty = await things.create({ thingtime: ['data'], crystal: { schema: 'one' } });
		await things.create({ thingtime: ['data'], crystal: { schema: 'two' } });
		const action = await things.create(
			definition(
				[
					{ op: 'things.search', where: { text: '$input.query' } },
					{ op: 'return', value: '$step.1' }
				],
				[{ capability: 'things.read', schemas: ['one'] }],
				{ inputs: [{ name: 'query', type: 'string' }] }
			)
		);
		const run = await actions.run({ action: action.id });
		assert.equal(run.status, 'ok', run.error);
		assert.deepEqual(
			(run.result as any[]).map((row) => row.id),
			[empty.id]
		);
	} finally {
		await db.close();
	}
});

test('run history is bounded, cannot be forged or imported and cascades only with its Action', async () => {
	const { db, things, actions } = fixture();
	try {
		const action = await things.create(definition([{ op: 'return', value: 0 }]));
		for (let i = 0; i < 53; i++) await actions.run({ action: action.id });
		const records = (await things.snapshot()).filter((row) => row.thingtime.includes('action-run'));
		assert.equal(records.length, 50);
		await assert.rejects(things.create({ thingtime: ['action-run'], targetId: action.id, crystal: {} }), /dedicated|protected|system|managed/i);
		await assert.rejects(things.update({ id: records[0].id, crystal: { status: 'forged' } }), /dedicated|protected|system|managed/i);
		await assert.rejects(things.remove([records[0].id]), /protected run history/);
		const manifest = {
			format: 'thingtime.transfer',
			version: 1,
			roots: ['a'],
			files: [],
			things: [{ id: 'a', thingtime: ['action-run'], crystal: {} }]
		};
		await assert.rejects(things.import(manifest), /managed|protected|cannot.*import/i);
		const bundle = await things.export([action.id]);
		const imported = await things.import(bundle.manifest);
		assert.equal((await actions.run({ action: imported.idMap[action.id] })).result, 0);
		await things.remove([action.id]);
		assert.equal((await actions.runs({ action: action.id })).runs.length, 0);
	} finally {
		await db.close();
	}
});

test('retiring identity during an invocation prevents later writes and run records', async () => {
	const { db, things } = fixture();
	let current = true;
	const action = await things.create(
		definition([
			{ op: 'compute', value: 'start' },
			{ op: 'return', value: true }
		])
	);
	// Retire during the asynchronous storage read, not before invocation.
	const original = db.transaction.bind(db);
	let reads = 0;
	db.transaction = ((...args: Parameters<typeof original>) => {
		const result = original(...args);
		if (args[1] === 'readonly' && ++reads === 1)
			return result.then((value) => {
				current = false;
				return value;
			});
		return result;
	}) as typeof db.transaction;
	const changed = {
		...lease,
		assertCurrent() {
			if (!current) throw new Error('Workspace changed');
		}
	};
	try {
		await assert.rejects(new LocalActions(db, scope, changed).run({ action: action.id }), /Workspace changed/);
		assert.equal((await things.snapshot()).length, 1);
	} finally {
		await db.close();
	}
});

test('concurrent invocations are bounded and a history failure reports the completed result without rerunning', async () => {
	const { db, things, actions } = fixture();
	try {
		const action = await things.create(definition([{ op: 'return', value: 'done' }]));
		const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => actions.run({ action: action.id })));
		assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 4);
		assert.match((attempts.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason.message, /Four local Actions/);
		const original = db.transaction.bind(db);
		db.transaction = ((...args: Parameters<typeof original>) =>
			args[1] === 'readwrite' ? Promise.reject(new Error('History storage unavailable')) : original(...args)) as typeof db.transaction;
		const run = await actions.run({ action: action.id });
		assert.equal(run.status, 'ok');
		assert.equal(run.result, 'done');
		assert.equal(run.historyError, 'History storage unavailable');
		assert.equal((await actions.runs({ action: action.id })).runs.length, 4);
	} finally {
		await db.close();
	}
});
