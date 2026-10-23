import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { WorkspaceDatabase } from './storage';
import { LocalThemes } from './themes';
import { LocalThings } from './things';
import { LocalTimeline } from './timeline';
import { AccountThemeSync, type AccountThemeTransport } from './accountThemes';
import { AccountThingSync } from './accountSync';
import { parseTransfer, serializeTransfer } from '../utils/thingTransfer/format';
import { themeContentValue } from '../timeline/themeContent';
const lease = { assertCurrent() {}, onInvalidate: () => () => {} },
	anonymous = { kind: 'anonymous' } as const;
const home = { kind: 'account', ownerId: 'owner', origin: 'https://title.test', dataPlane: 'home' } as const;
const version = (n: number) => 'theme-state-v1:' + n.toString(16).padStart(64, '0');
const remote = () => ({
	id: 'remote-theme',
	name: 'Source name',
	title: 'Old title',
	theme: { colors: { accent: '#bb8866' } },
	visibility: 'private',
	folderId: null,
	version: version(1),
	createdAt: '2026-10-17T00:00:00.000Z',
	updatedAt: '2026-10-17T00:00:00.000Z'
});
test('anonymous display titles preserve source content, selection, History and remapped portable copies', async () => {
	const db = new WorkspaceDatabase(new IDBFactory()),
		themes = new LocalThemes(db, lease),
		things = new LocalThings(db, anonymous, lease),
		history = new LocalTimeline(db, lease, home.origin);
	try {
		const saved = (await themes.save({ name: 'Source name', theme: { colors: { accent: '#bb8866' } } })).theme;
		await themes.setActive(saved.id);
		const before = await things.get(saved.id);
		const renamed = await things.renameLibrary({ id: saved.id, displayTitle: '  Library display  ', expectedUpdatedAt: before.updatedAt });
		assert.equal(renamed.crystal.title, 'Library display');
		assert.equal(renamed.crystal.name, 'Source name');
		assert.deepEqual(renamed.crystal.theme, before.crystal.theme);
		assert.equal((await themes.list()).activeThemeId, saved.id);
		await assert.rejects(things.renameLibrary({ id: saved.id, displayTitle: 'Stale', expectedUpdatedAt: before.updatedAt }), /changed/);
		for (const displayTitle of ['', ' '.repeat(5), 'x'.repeat(121), {}, null])
			await assert.rejects(things.renameLibrary({ id: saved.id, displayTitle }));
		await assert.rejects(things.renameLibrary({ id: saved.id, displayTitle: 'Attack', visibility: 'public' } as any));
		await assert.rejects(things.update({ id: saved.id, crystal: { title: 'Generic bypass' } }), /dedicated/);
		const entries = (await history.page({ thingId: saved.id, limit: 20, before: null, after: null })).entries;
		assert.equal(themeContentValue(entries[0].event.after!).crystal.title, 'Library display');
		const bundle = parseTransfer(serializeTransfer((await things.export([saved.id])).manifest)),
			copy = await things.import(bundle);
		assert.notEqual(copy.idMap[saved.id], saved.id);
		assert.deepEqual((await things.get(copy.idMap[saved.id])).crystal, renamed.crystal);
		await themes.save({ id: saved.id, name: 'Renamed source', theme: { colors: { accent: '#112233' } } });
		assert.equal((await things.get(saved.id)).crystal.title, 'Library display');
	} finally {
		await db.close();
	}
});
test('account titles replay a lost immutable write before later edits without generic protected writes', async () => {
	const db = new WorkspaceDatabase(new IDBFactory()),
		themes = new AccountThemeSync(db, home, lease),
		sync = new AccountThingSync(db, home, lease, undefined, undefined, undefined, themes);
	try {
		const original = remote();
		await themes.remember([original], await themes.beginRead());
		await sync.things.renameLibrary({ id: original.id, displayTitle: 'First title' });
		const commands: any[] = [],
			receipts = new Map<string, any>();
		let lose = true;
		const transport: AccountThemeTransport = {
			snapshot: async () => [],
			write: async (command) => {
				commands.push(structuredClone(command));
				let receipt = receipts.get(command.writeId);
				if (!receipt) {
					receipt = {
						id: command.id,
						writeId: command.writeId,
						action: command.action,
						expectedVersion: command.expectedVersion,
						resultVersion: version(receipts.size + 2)
					};
					receipts.set(command.writeId, receipt);
				}
				if (lose) {
					lose = false;
					throw Error('lost successful response');
				}
				return receipt;
			}
		};
		await themes.sync(transport);
		await sync.things.renameLibrary({ id: original.id, displayTitle: 'Latest title' });
		await themes.retry(original.id);
		await themes.sync(transport);
		assert.deepEqual(commands[0], commands[1]);
		assert.equal(commands[0].title, 'First title');
		assert.equal(commands[2].title, 'Latest title');
		assert.equal(commands[2].expectedVersion, version(2));
		assert.equal(commands[2].name, original.name);
		assert.equal(commands[2].visibility, 'private');
		assert.deepEqual(commands[2].theme, commands[0].theme);
		assert.deepEqual(await sync.status(), []);
		assert.equal((await themes.exportSnapshot()).things[0].crystal.title, 'Latest title');
		await themes.save({ id: original.id, name: 'Token editor', theme: {} });
		await themes.sync(transport);
		assert.equal('title' in commands.at(-1), false);
	} finally {
		await db.close();
	}
});
test('old caches require title metadata before complete export and preserve pending tokens during upgrade', async () => {
	const db = new WorkspaceDatabase(new IDBFactory()),
		themes = new AccountThemeSync(db, home, lease),
		sync = new AccountThingSync(db, home, lease, undefined, undefined, undefined, themes);
	try {
		const current = remote(),
			{ title, ...old } = current;
		await themes.remember([old], await themes.beginRead());
		assert.equal((await themes.exportSnapshot()).records[0].complete, false);
		await themes.save({ id: current.id, name: 'Offline tokens', theme: { colors: { accent: '#112233' } } });
		await themes.remember([current], await themes.beginRead());
		assert.equal((await sync.view(current.id))?.crystal.name, 'Offline tokens');
		assert.equal((await sync.view(current.id))?.crystal.title, title);
		assert.equal((await themes.exportSnapshot()).records[0].complete, true);
		await sync.things.renameLibrary({ id: current.id, displayTitle: 'Device title' });
		await themes.remember([{ ...current, title: 'Stale remote title' }], await themes.beginRead());
		assert.equal((await sync.view(current.id))?.crystal.title, 'Device title');
	} finally {
		await db.close();
	}
});
test('custom-plane title refusals roll back content and queue', async () => {
	const db = new WorkspaceDatabase(new IDBFactory()),
		scope = { ...home, dataPlane: 'custom' },
		themes = new AccountThemeSync(db, scope, lease),
		sync = new AccountThingSync(db, scope, lease, undefined, undefined, undefined, themes);
	try {
		const row = remote();
		await themes.remember([row], await themes.beginRead());
		const before = await sync.view(row.id);
		await assert.rejects(sync.things.renameLibrary({ id: row.id, displayTitle: 'Forbidden' }), /home library/);
		assert.deepEqual(await sync.view(row.id), before);
		assert.equal((await themes.status())[0].state, 'synced');
	} finally {
		await db.close();
	}
});
