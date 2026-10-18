import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { LocalAccountHomeThemes } from './homeThemes';
import { AccountThemeSync } from './accountThemes';
import { LocalThemes } from './themes';
import { LocalThings } from './things';
import { WorkspaceDatabase } from './storage';
import { parseTransfer, serializeTransfer } from '../utils/thingTransfer/format';
import { MAX_SAVED_THEMES } from '../theme/savedTheme';
import { transferChecksum } from '../utils/thingTransfer/archive';
const selected = { kind: 'account', origin: 'https://home-local.example', ownerId: 'owner', dataPlane: 'custom-' + 'a'.repeat(64) } as const;
const home = { ...selected, dataPlane: 'home' },
	lease = { assertCurrent() {}, onInvalidate: () => () => {} };
const database = () => new WorkspaceDatabase(new IDBFactory(), 'home-local', 1000, IDBKeyRange);

test('different selected databases use one local home theme and selection while other identities remain isolated', async () => {
	const db = database(),
		a = new LocalAccountHomeThemes(db, selected, lease),
		b = new LocalAccountHomeThemes(db, { ...selected, dataPlane: 'custom-' + 'b'.repeat(64) }, lease);
	const previous = globalThis.fetch;
	let requests = 0;
	globalThis.fetch = async () => {
		requests++;
		throw Error('Unexpected account request');
	};
	try {
		const item = (await a.themes.save({ name: 'Home edit', theme: {} })).theme;
		await a.themes.setActive(item.id);
		assert.equal((await b.list()).themes[0].id, item.id);
		assert.equal((await b.list()).activeThemeId, item.id);
		await b.themes.save({ id: item.id, name: 'Edited from another selected database', theme: {} });
		assert.equal((await a.list()).themes[0].name, 'Edited from another selected database');
		for (const scope of [
			{ ...selected, ownerId: 'other' },
			{ ...selected, origin: 'https://other.example' }
		])
			assert.deepEqual((await new LocalAccountHomeThemes(db, scope, lease).list()).themes, []);
		assert.deepEqual((await new LocalThemes(db, lease).list()).themes, []);
		assert.throws(() => new LocalAccountHomeThemes(db, { kind: 'anonymous' } as any, lease), /Anonymous/);
		assert.equal(requests, 0);
	} finally {
		globalThis.fetch = previous;
		await db.close();
	}
});

test('explicit home import preserves a mixed editable bundle atomically and exports before any remote sender', async () => {
	const db = database(),
		workspace = new LocalAccountHomeThemes(db, selected, lease);
	const bundle = {
		format: 'thingtime.transfer',
		version: 1,
		roots: ['folder'],
		things: [
			{ id: 'folder', thingtime: ['folder'], crystal: { name: 'Mixed home bundle' } },
			{
				id: 'theme',
				thingtime: ['theme'],
				crystal: { name: 'Peach', title: 'Display peach', theme: { colors: { accent: '#bf8068' } } },
				folderId: 'folder'
			},
			{ id: 'data', thingtime: ['data'], crystal: { value: 'Editable companion' }, folderId: 'folder' }
		],
		files: []
	};
	try {
		const imported = await workspace.import(bundle);
		assert.equal(imported.storagePlane, 'home');
		const list = await workspace.list();
		assert.equal(list.themes.length, 1);
		assert.equal(list.activeThemeId, null);
		assert.equal(list.themes[0].visibility, 'private');
		assert.equal(list.themes[0].syncState, 'pending');
		assert.deepEqual(await db.transaction(selected, 'readonly', lease, (t) => t.list('things')), []);
		const homeRows = await db.transaction(home, 'readonly', lease, (t) => t.list<any>('things'));
		for (const id of ['folder', 'theme', 'data']) assert.notEqual(imported.idMap[id], id);
		assert.equal(homeRows.find((row) => row.id === imported.idMap.theme)!.value.folderId, imported.idMap.folder);
		assert.equal(homeRows.find((row) => row.id === imported.idMap.data)!.value.folderId, imported.idMap.folder);
		const queued = await db.transaction(home, 'readonly', lease, (t) => t.list('thing-sync'));
		assert.equal(queued.length, 2);
		const exported = await workspace.export({ ids: imported.roots });
		const portable = parseTransfer(
			serializeTransfer({
				format: 'thingtime.transfer',
				version: 1,
				roots: exported.plan.roots,
				things: exported.plan.things,
				files: exported.plan.files
			})
		);
		assert.equal(portable.things.length, 3);
		const anon = new LocalThings(db, { kind: 'anonymous' }, lease),
			copy = await anon.import(portable);
		const theme = await anon.get(copy.idMap[imported.idMap.theme]);
		assert.equal(theme.crystal.title, 'Display peach');
		assert.equal(theme.folderId, copy.idMap[imported.idMap.folder]);
		assert.equal((await anon.get(copy.idMap[imported.idMap.data])).crystal.value, 'Editable companion');
		assert.ok(!JSON.stringify(portable).includes('receiptPlane'));
	} finally {
		await db.close();
	}
});

test('unresolved legacy edits are reported without blocking independent home editing', async () => {
	// Only the content identity collides across partitions. Each subsequent
	// operation and History event still needs its own legitimate identity.
	const ids = (first: ReturnType<typeof randomUUID>) => { let used = false; return () => { if (used) return randomUUID(); used = true; return first; }; };
	const db = database(),
		id = randomUUID(),
		old = new AccountThemeSync(
			db,
			selected,
			lease,
			() => 1000,
			ids(id)
		),
		workspace = new LocalAccountHomeThemes(
			db,
			selected,
			lease,
			() => 2000,
			ids(id)
		);
	try {
		await old.save({ name: 'Legacy edit', theme: {} });
		await workspace.themes.save({ name: 'Home edit', theme: {} });
		const before = await old.status(),
			listed = await workspace.list();
		assert.equal(listed.migration.partitions[0].result.issues[0].reason, 'different-device-version');
		await workspace.themes.save({ id, name: 'Newer home edit', theme: {} });
		assert.equal((await workspace.list()).themes[0].name, 'Newer home edit');
		assert.equal((await old.list()).themes[0].name, 'Legacy edit');
		assert.deepEqual(await old.status(), before);
	} finally {
		await db.close();
	}
});

test('a migration quota failure keeps existing home editors usable and source data intact', async () => {
	const db = database(),
		workspace = new LocalAccountHomeThemes(db, selected, lease),
		old = new AccountThemeSync(db, selected, lease);
	try {
		let id = '';
		for (let n = 0; n < MAX_SAVED_THEMES; n++) id = (await workspace.themes.save({ name: 'Home ' + n, theme: {} })).theme.id;
		const source = (await old.save({ name: 'Retained old edit', theme: {} })).theme;
		const list = await workspace.list();
		assert.equal(list.migration.error?.code, 'LOCAL_QUOTA');
		assert.equal(list.themes.length, MAX_SAVED_THEMES);
		await workspace.themes.save({ id, name: 'Still editable offline', theme: {} });
		assert.equal((await workspace.themes.list()).themes.find((row) => row.id === id)!.name, 'Still editable offline');
		assert.equal((await old.list()).themes[0].id, source.id);
	} finally {
		await db.close();
	}
});

test('retiring the selected-account lease also retires its local home operations', async () => {
	const db = database();
	let current = true;
	const bound = {
		assertCurrent() {
			if (!current) throw Error('Account changed');
		},
		onInvalidate: () => () => {}
	};
	const workspace = new LocalAccountHomeThemes(db, selected, bound);
	try {
		await workspace.themes.save({ name: 'Before account switch', theme: {} });
		current = false;
		await assert.rejects(workspace.list(), /Account changed/);
		await assert.rejects(workspace.themes.save({ name: 'Stale write', theme: {} }), /Account changed/);
		assert.equal((await new AccountThemeSync(db, home, lease).list()).themes.length, 1);
	} finally {
		await db.close();
	}
});

test('a home theme bundle retains exact file bytes and independent upload intent without contacting the selected database', async () => {
	const db = database(),
		workspace = new LocalAccountHomeThemes(db, selected, lease),
		bytes = new TextEncoder().encode('Portable home original');
	try {
		const manifest = {
			format: 'thingtime.transfer',
			version: 1,
			roots: ['folder'],
			things: [
				{ id: 'folder', thingtime: ['folder'], crystal: { name: 'Theme with original' } },
				{ id: 'theme', thingtime: ['theme'], folderId: 'folder', crystal: { name: 'Peach', theme: {} } },
				{ id: 'file', thingtime: ['attachment'], folderId: 'folder', crystal: { recordingFileId: 'bytes', filePurpose: 'file' } }
			],
			files: [
				{
					id: 'bytes',
					targetId: 'file',
					path: 'files/000000',
					name: 'original.txt',
					mime: 'text/plain',
					bytes: bytes.length,
					sha256: await transferChecksum(bytes),
					title: 'Editable original'
				}
			]
		};
		await assert.rejects(workspace.import(manifest, null, new Map([['bytes', new Uint8Array(bytes.length)]])), /checksum|hash|match/i);
		assert.deepEqual(await db.transaction(home, 'readonly', lease, (t) => t.list('things')), []);
		const imported = await workspace.import(manifest, null, new Map([['bytes', bytes]]));
		const exported = await workspace.export({ ids: imported.roots });
		assert.equal(exported.plan.things.length, 3);
		assert.equal(exported.plan.files.length, 1);
		assert.equal(exported.plan.files[0].title, 'Editable original');
		assert.deepEqual(new Uint8Array(await (await exported.plan.readLocalFile(exported.plan.files[0].id)).arrayBuffer()), bytes);
		assert.deepEqual(await db.transaction(selected, 'readonly', lease, (t) => t.list('account-files')), []);
		assert.equal((await db.transaction(home, 'readonly', lease, (t) => t.list('account-files'))).length, 1);
	} finally {
		await db.close();
	}
});
