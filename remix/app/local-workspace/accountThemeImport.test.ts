import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { AccountThingSync } from './accountSync';
import { AccountThemeSync, type AccountThemeTransport } from './accountThemes';
import { LocalThings } from './things';
import { WorkspaceDatabase } from './storage';
import { accountImportSupported } from './accountImport';
import { exportAccountThings } from './accountExport';
import { parseTransfer, serializeTransfer, type ThingTransfer } from '../utils/thingTransfer/format';
const home = { kind: 'account', ownerId: 'owner', origin: 'https://theme-import.test', dataPlane: 'home' } as const;
const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
const bundle = (folder = true): ThingTransfer => ({
	format: 'thingtime.transfer',
	version: 1,
	roots: [folder ? 'folder' : 'theme'],
	things: [
		{
			id: 'theme',
			thingtime: ['theme'],
			crystal: { name: 'Imported peach', theme: { colors: { accent: '#bf8068' } } },
			...(folder ? { folderId: 'folder' } : {})
		},
		...(folder ? [{ id: 'folder', thingtime: ['folder'], crystal: { name: 'Looks' } }] : [])
	],
	files: []
});
const fixture = (scope: typeof home | { kind: 'account'; ownerId: string; origin: string; dataPlane: string } = home) => {
	const db = new WorkspaceDatabase(new IDBFactory()),
		themes = new AccountThemeSync(db, scope, lease),
		sync = new AccountThingSync(db, scope, lease, undefined, undefined, undefined, themes);
	return { db, themes, sync, scope };
};
test('account theme import atomically remaps folder/content/intent, stays private and exports before either sender runs', async () => {
	const f = fixture();
	try {
		assert.equal(accountImportSupported(bundle()), true);
		const imported = await f.sync.things.import(bundle());
		assert.notEqual(imported.idMap.theme, 'theme');
		assert.notEqual(imported.idMap.folder, 'folder');
		const theme = (await f.themes.list()).themes[0];
		assert.equal(theme.id, imported.idMap.theme);
		assert.equal(theme.visibility, 'private');
		assert.equal(theme.syncState, 'pending');
		assert.equal((await f.themes.list()).activeThemeId, null);
		const generic = await f.sync.status();
		assert.equal(generic.length, 1);
		assert.equal(generic[0].id, imported.idMap.folder);
		const exported = await exportAccountThings(
			{ ids: imported.roots },
			{
				...f,
				lease,
				canRefresh: () => false,
				remote: async () => {
					throw Error('No account request');
				}
			}
		);
		const manifest = parseTransfer(
			serializeTransfer({
				format: 'thingtime.transfer',
				version: 1,
				roots: exported.plan.roots,
				things: exported.plan.things,
				files: exported.plan.files
			})
		);
		const copy = await new LocalThings(f.db, { kind: 'anonymous' }, lease).import(manifest);
		const copied = await new LocalThings(f.db, { kind: 'anonymous' }, lease).get(copy.idMap[theme.id]);
		assert.equal(copied.folderId, copy.idMap[imported.idMap.folder]);
		assert.deepEqual(copied.crystal.theme, theme.theme);
		await assert.rejects(f.sync.things.update({ id: theme.id, crystal: { name: 'Generic overwrite' } }), /dedicated|protected/i);
		await assert.rejects(new LocalThings(f.db, home, lease).import(bundle(false)), /dedicated/);
	} finally {
		await f.db.close();
	}
});
test('only background sync waits for the imported folder and lost creates replay immutable placement before a later edit', async () => {
	const f = fixture();
	try {
		const imported = await f.sync.things.import(bundle()),
			commands: any[] = [],
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
						resultVersion: 'theme-state-v1:' + receipts.size.toString(16).padStart(64, 'a')
					};
					receipts.set(command.writeId, receipt);
				}
				if (lose) {
					lose = false;
					throw Error('lost response');
				}
				return receipt;
			}
		};
		assert.equal((await f.themes.sync(transport)).completed, 0);
		assert.equal(commands.length, 0);
		assert.equal(
			(
				await f.sync.sync({
					get: async () => {
						throw { status: 404 };
					},
					write: async (op) => ({
						id: op.id,
						thingtime: op.body.thingtime as string[],
						crystal: op.body.crystal as any,
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
						revision: 1,
						author: { id: home.ownerId },
						acl: ['tt:user'],
						visibility: 'private'
					})
				})
			).completed,
			1
		);
		await f.themes.sync(transport);
		assert.equal(commands[0].folderId, imported.idMap.folder);
		await f.themes.save({ id: imported.idMap.theme, name: 'Later device edit', theme: { colors: { accent: '#887744' } } });
		await f.themes.retry(imported.idMap.theme);
		await f.themes.sync(transport);
		assert.deepEqual(commands[1], commands[0]);
		assert.notEqual(commands[2].writeId, commands[0].writeId);
		assert.equal(commands[2].name, 'Later device edit');
		assert.equal(commands[2].folderId, imported.idMap.folder);
		assert.equal((await f.themes.status())[0].state, 'synced');
	} finally {
		await f.db.close();
	}
});
test('account imports retain more than 100 themes with only dedicated private sync intents', async (t) => {
	const f = fixture();
	t.after(() => f.db.close());
	const input = bundle(false);
	input.things = Array.from({ length: 101 }, (_, i) => ({ ...input.things[0], id: 'theme-' + i }));
	input.roots = input.things.map(row => row.id);
	const result = await f.sync.things.import(input);
	assert.equal(result.roots.length, 101);
	const list = await f.themes.list();
	assert.equal(list.themes.length, 101);
	assert.ok(list.themes.every(row => row.visibility === 'private' && row.syncState === 'pending'));
	assert.equal((await f.themes.status()).length, 101);
	assert.deepEqual(await f.sync.status(), [], 'protected content never enters the generic sender');
});

test('invalid themes and home/custom placement conflicts roll back the whole import without generic protected queues', async () => {
	const f = fixture();
	try {
		const invalid = bundle();
		invalid.things[0].crystal.ownerId = 'forged';
		await assert.rejects(f.sync.things.import(invalid), /only a name/);
		assert.deepEqual(await f.sync.things.snapshot(), []);
		assert.deepEqual(await f.sync.status(), []);
		assert.deepEqual(await f.themes.status(), []);
		for (const scope of [
			{ ...home, ownerId: 'other' },
			{ ...home, origin: 'https://other.test' },
			{ ...home, dataPlane: 'custom' }
		])
			assert.throws(() => new AccountThingSync(f.db, scope, lease, undefined, undefined, undefined, f.themes), /different account/);
	} finally {
		await f.db.close();
	}
	const custom = fixture({ ...home, dataPlane: 'custom' });
	try {
		const placed = bundle();
		placed.things.reverse();
		await assert.rejects(custom.sync.things.import(placed), /home library/);
		assert.deepEqual(await custom.sync.things.snapshot(), []);
		assert.deepEqual(await custom.sync.status(), []);
		assert.deepEqual(await custom.themes.status(), []);
		const root = await custom.sync.things.import(bundle(false));
		assert.equal((await custom.themes.list()).themes[0].id, root.idMap.theme);
	} finally {
		await custom.db.close();
	}
});

test('conflict copies preserve uncached existing folder placement without waiting for a nonexistent local create', async () => {
	const f = fixture();
	const stamp = '2026-10-17T00:00:00.000Z';
	const remote = {
		id: 'filed-theme',
		name: 'Account original',
		theme: {},
		visibility: 'private' as const,
		folderId: 'known-folder',
		version: 'theme-state-v1:' + 'a'.repeat(64),
		createdAt: stamp,
		updatedAt: stamp
	};
	const commands: any[] = [];
	const transport: AccountThemeTransport = {
		snapshot: async () => [remote],
		write: async (command) => {
			commands.push(command);
			if (command.id === remote.id) throw { status: 409 };
			return {
				id: command.id,
				writeId: command.writeId,
				action: command.action,
				expectedVersion: command.expectedVersion,
				resultVersion: 'theme-state-v1:' + 'b'.repeat(64)
			};
		}
	};
	try {
		await f.themes.refresh(transport);
		await f.themes.save({ id: remote.id, name: 'Device variant', theme: { colors: { accent: '#bf8068' } } });
		await f.themes.sync(transport);
		const review = await f.themes.inspect(remote.id, transport);
		const { copyId } = await f.themes.resolve(review, 'copy', transport);
		assert.ok(copyId);
		await f.themes.sync(transport);
		assert.equal(commands.length, 2);
		assert.equal(commands[1].id, copyId);
		assert.equal(commands[1].folderId, remote.folderId);
		assert.equal(commands[1].visibility, 'private');
		assert.equal((await f.themes.list()).themes.find((row) => row.id === remote.id)?.name, remote.name);
		assert.equal((await f.themes.status()).find((row) => row.id === copyId)?.state, 'synced');
	} finally {
		await f.db.close();
	}
});
