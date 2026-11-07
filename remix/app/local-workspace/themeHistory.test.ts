import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { WorkspaceDatabase } from './storage';
import { LocalThemes } from './themes';
import { LocalThings } from './things';
import { LocalTimeline, recordLocalThingChanges } from './timeline';
import { createExportVersionService } from '../api/utils/timeline/exportVersion';
import { parseTimelineVersionExport } from '../timeline/exportVersion';
import { historyContent } from '../timeline/browserModel';
import { themeContentValue } from '../timeline/themeContent';
const scope = { kind: 'anonymous' } as const,
	lease = { assertCurrent() {}, onInvalidate: () => () => {} };
const query = (thingId: string | null) => ({ thingId, before: null, after: null, limit: 40 });
test('anonymous theme save/edit/delete and imports retain the canonical protected History projection', async () => {
	const db = new WorkspaceDatabase(new IDBFactory()),
		themes = new LocalThemes(db, lease),
		things = new LocalThings(db, scope, lease),
		history = new LocalTimeline(db, lease, 'https://local.example');
	try {
		const saved = (await themes.save({ name: 'Peach', theme: { colors: { accent: '#bb8866' } } })).theme;
		await themes.setActive(saved.id);
		const first = (await history.page(query(saved.id))).entries;
		assert.equal(first.length, 1);
		assert.equal(first[0].event.after?.adapter, 'theme-content');
		assert.deepEqual(historyContent(first[0].event.after), { crystal: themeContentValue(first[0].event.after!).crystal, kinds: ['theme'] });
		assert.equal(themeContentValue(first[0].event.after!).visibility, 'private');
		await themes.save({ id: saved.id, name: 'New peach', theme: { colors: { accent: '#885544' } } });
		const exportContent = (await things.export([saved.id])).manifest;
		const imported = await things.import(exportContent);
		assert.notEqual(imported.roots[0], saved.id);
		assert.equal((await history.page(query(imported.roots[0]))).entries.length, 1);
		await themes.remove(saved.id);
		const versions = (await history.page(query(saved.id))).entries;
		assert.deepEqual(
			versions.map((x) => x.event.operation),
			['delete', 'update', 'create']
		);
		assert.equal(themeContentValue(versions[1].event.before!).crystal.name, 'Peach');
		assert.equal(
			themeContentValue(versions[1].event.after!).crystal.theme.colors &&
				(themeContentValue(versions[1].event.after!).crystal.theme.colors as any).accent,
			'#885544'
		);
		const archive = await history.exportVersion(first[0].event.id);
		assert.equal(archive.export.content.adapter, 'theme-content');
		const accountExport = createExportVersionService({
			collection: async () => ({} as any),
			entries: async () => [first[0]],
			snapshot: async (_db, _owner, _id, side) => first[0].event[side],
			notes: async () => [],
			names: async () => [],
			now: () => new Date(archive.export.exportedAt)
		});
		assert.deepEqual(await accountExport(first[0].event.ownerId, first[0].event.id), archive.export);
		assert.equal(await accountExport('other-account', first[0].event.id), null);

		assert.equal((archive.export.content.value as any).crystal.theme.colors.accent, '#bb8866');
		assert.equal(parseTimelineVersionExport(archive, { ownerId: first[0].event.ownerId, id: first[0].event.id }).content.adapter, 'theme-content');
		const changed = JSON.parse(JSON.stringify(archive));
		(changed.export.content.value as any).crystal.name = 'Tampered';
		assert.throws(() => parseTimelineVersionExport(changed, { ownerId: first[0].event.ownerId, id: first[0].event.id }), /Invalid Timeline theme/);
		const deleted = await history.exportVersion(versions[0].event.id);
		assert.equal(themeContentValue(deleted.export.content).crystal.name, 'New peach');
		await assert.rejects(things.update({ id: imported.roots[0], crystal: { name: 'Generic bypass' } }), /dedicated/);
	} finally {
		await db.close();
	}
});
test('theme History storage failure rolls back the saved content', async () => {
	const db = new WorkspaceDatabase(new IDBFactory());
	const original = db.transaction.bind(db);
	db.transaction = ((scope, mode, lease, run) =>
		original(scope, mode, lease, (tx) =>
			run({
				...tx,
				put: async (collection, id, value) => {
					if (collection === 'timeline-events') throw Error('History quota fixture');
					return tx.put(collection, id, value);
				}
			})
		)) as typeof db.transaction;
	const themes = new LocalThemes(db, lease);
	try {
		await assert.rejects(themes.save({ name: 'Must roll back', theme: {} }), /History quota/);
		assert.equal((await themes.list()).themes.length, 0);
	} finally {
		await db.close();
	}
});

test('the theme history adapter does not admit other protected content or account theme writes', async () => {
	const db = new WorkspaceDatabase(new IDBFactory()),
		history = new LocalTimeline(db, lease, 'https://local.example');
	try {
		const now = () => new Date().toISOString();
		const row = {
			id: 'local-protected-fixture',
			thingtime: ['theme', 'user'],
			crystal: { name: 'Private', theme: {} },
			createdAt: now(),
			updatedAt: now(),
			revision: 1
		};
		const changes = new Map([[row.id, { before: null, after: row }]]);
		await db.transaction(scope, 'readwrite', lease, (tx) => recordLocalThingChanges(tx, changes, now, () => crypto.randomUUID()));
		row.thingtime = ['theme'];
		let writes = 0;
		await db.transaction(scope, 'readwrite', lease, (tx) =>
			recordLocalThingChanges(tx, changes, now, () => crypto.randomUUID(), undefined, {
				ownerId: 'account',
				clientId: 'device',
				branchId: 'device',
				mode: 'draft',
				read: async () => null,
				append: async () => {
					writes++;
				}
			})
		);
		assert.equal(writes, 0);
		assert.deepEqual((await history.page(query(null))).entries, []);
	} finally {
		await db.close();
	}
});
