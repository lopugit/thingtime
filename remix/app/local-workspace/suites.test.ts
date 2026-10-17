import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { ALL_SUITES } from '../schemas/appSuites';
import { materializeSuite } from '../schemas/behaviourSuites';
import { validateTransfer } from '../utils/thingTransfer/format';
import { LocalThings } from './things';
import { installLocalSuite } from './suites';
import { LocalActions } from './actions';
import { WorkspaceDatabase, type WorkspaceLease } from './storage';

const scope = { kind: 'anonymous' as const };
const lease: WorkspaceLease = { assertCurrent() {}, onInvalidate: () => () => {} };

test('every bundled suite installs editable definitions locally and repeats without duplicate records', async () => {
	for (const suite of ALL_SUITES) {
		const db = new WorkspaceDatabase(new IDBFactory());
		try {
			const things = new LocalThings(db, scope, lease);
			const first = await installLocalSuite(things, suite.key);
			const bundle = materializeSuite(suite, 'own');
			assert.equal(
				first.created,
				bundle.schemas.length + bundle.components.length + bundle.actions.length + bundle.data.length + bundle.pages.length,
				suite.key
			);
			const second = await installLocalSuite(things, suite.key);
			assert.equal(second.created, 0, suite.key);
			assert.deepEqual(second.pageIds, first.pageIds);
			const third = await installLocalSuite(things, suite.key);
			assert.equal(third.updated, 0, suite.key);
			assert.equal((await things.snapshot()).length, first.created);
			const page = await things.get(first.entryPageId);
			assert.equal(page.crystal.pageKey, first.entryPageKey);
			assert.ok(JSON.stringify(page.crystal).includes('local-'), suite.key);
			for (const id of first.dataIds) {
				const data = await things.get(id);
				assert.ok(Object.values(first.schemaIds).includes(String(data.crystal.schemaId)), suite.key);
			}
		} finally {
			await db.close();
		}
	}
});

test('concurrent installation is atomic and preserves authored edits in only-missing mode', async () => {
	const db = new WorkspaceDatabase(new IDBFactory()),
		things = new LocalThings(db, scope, lease);
	try {
		const suite = ALL_SUITES.find((s) => s.data.length && s.components.length)!;
		const [a, b] = await Promise.all([installLocalSuite(things, suite.key), installLocalSuite(things, suite.key)]);
		assert.deepEqual(a.pageIds, b.pageIds);
		assert.equal(b.created, 0);
		const componentId = Object.values(a.componentIds)[0];
		await things.update({ id: componentId, crystal: { description: 'My edited component' } });
		await things.update({ id: a.dataIds[0], crystal: { customValue: 'Keep my data' } });
		await installLocalSuite(things, suite.key, { onlyMissing: true });
		assert.equal((await things.get(componentId)).crystal.description, 'My edited component');
		await installLocalSuite(things, suite.key);
		assert.equal((await things.get(a.dataIds[0])).crystal.customValue, 'Keep my data');
		const before = await things.snapshot();
		await assert.rejects(
			things.atomic(async (writer) => {
				await writer.create({ thingtime: ['data'], crystal: { text: 'Must roll back' } });
				await writer.create({ thingtime: ['action'], crystal: { steps: [{ op: 'invented' }] } });
			}),
			/action|operation|name/i
		);
		assert.deepEqual(await things.snapshot(), before);
		await assert.rejects(installLocalSuite(things, 'unknown-suite'), /bundled catalogue/);
		const account = new LocalThings(db, { kind: 'account', origin: 'https://example.test', ownerId: 'owner', dataPlane: 'main' }, lease);
		await assert.rejects(installLocalSuite(account, suite.key), /sync adapter/);
	} finally {
		await db.close();
	}
});

test('installed suite Actions execute locally and its canonical export imports with independent IDs', async () => {
	const db = new WorkspaceDatabase(new IDBFactory()),
		things = new LocalThings(db, scope, lease);
	try {
		const suite = ALL_SUITES.find((s) => s.key === 'web-standards')!;
		const installed = await installLocalSuite(things, suite.key);
		const run = await new LocalActions(db, scope, lease).run({ action: installed.actionIds.catalogue });
		assert.equal(run.status, 'ok', run.error);
		assert.ok(run.result);
		const save = await new LocalActions(db, scope, lease).run({
			action: installed.actionIds['save-draft'],
			inputs: {
				program: {
					version: 1,
					title: 'Offline editable program',
					inputs: [],
					nodes: [{ id: 'answer', op: 'literal', value: 42 }],
					result: { ref: 'answer' }
				}
			}
		});
		assert.equal(save.status, 'ok', save.error);
		const saved = await things.get((save.result as { id: string }).id);
		assert.equal(saved.crystal.name, 'Offline editable program');
		const exported = await things.export(Object.values(installed.pageIds));
		assert.doesNotThrow(() => validateTransfer(exported.manifest));
		const targetDb = new WorkspaceDatabase(new IDBFactory());
		try {
			const target = new LocalThings(targetDb, scope, lease);
			const imported = await target.import(exported.manifest);
			assert.notEqual(imported.idMap[installed.entryPageId], installed.entryPageId);
			const page = await target.get(imported.idMap[installed.entryPageId]);
			assert.equal(page.crystal.pageKey, installed.entryPageKey);
		} finally {
			await targetDb.close();
		}
	} finally {
		await db.close();
	}
});
