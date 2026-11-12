import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { AccountThemeSync, type AccountThemeSnapshot, type AccountThemeTransport } from './accountThemes';
import { AccountThingSync, type AccountSyncTransport } from './accountSync';
import { WorkspaceDatabase } from './storage';
const scope = { kind: 'account', ownerId: 'owner', origin: 'https://theme-organization.test', dataPlane: 'home' } as const;
const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
const stamp = '2026-10-17T00:00:00.000Z';
const version = (n: number) => 'theme-state-v1:' + n.toString(16).padStart(64, '0');
const folder = (id: string, parent?: string) => ({
	id,
	thingtime: ['folder'],
	crystal: { name: id },
	folderId: parent,
	createdAt: stamp,
	updatedAt: stamp,
	revision: 1,
	author: { id: scope.ownerId },
	acl: ['tt:user'],
	visibility: 'private'
});
const theme = (id: string, folderId: string | null): AccountThemeSnapshot => ({
	id,
	name: id,
	theme: {},
	folderId,
	visibility: 'private',
	createdAt: stamp,
	updatedAt: stamp,
	version: version(1)
});
const fixture = () => {
	const db = new WorkspaceDatabase(new IDBFactory()),
		themes = new AccountThemeSync(db, scope, lease),
		sync = new AccountThingSync(db, scope, lease, undefined, undefined, undefined, themes);
	return { db, themes, sync };
};
function server(initial: AccountThemeSnapshot[]) {
	const rows = new Map(initial.map((row) => [row.id, structuredClone(row)])),
		receipts = new Map<string, any>(),
		commands: any[] = [],
		events: string[] = [];
	let serial = 1,
		lose = false;
	const transport: AccountThemeTransport = {
		snapshot: async () => [...rows.values()],
		write: async (command) => {
			commands.push(structuredClone(command));
			events.push('theme:' + command.action);
			let ack = receipts.get(command.writeId);
			if (!ack) {
				const before = rows.get(command.id);
				if ((before?.version ?? null) !== command.expectedVersion) throw { status: 409 };
				const resultVersion = command.action === 'delete' ? null : version(++serial);
				if (command.action === 'delete') rows.delete(command.id);
				else
					rows.set(command.id, {
						...theme(command.id, command.folderId === undefined ? before?.folderId ?? null : command.folderId),
						name: command.name,
						theme: command.theme as any,
						visibility: command.visibility,
						version: resultVersion!
					});
				ack = { id: command.id, writeId: command.writeId, action: command.action, expectedVersion: command.expectedVersion, resultVersion };
				receipts.set(command.writeId, ack);
			}
			if (lose) {
				lose = false;
				throw Error('lost acknowledgement');
			}
			return ack;
		}
	};
	const generic: AccountSyncTransport = {
		get: async () => {
			throw { status: 404 };
		},
		write: async () => {
			throw Error('Protected content must not enter generic writes');
		},
		remove: async (op) => {
			assert.ok(
				[...rows.values()].every((row) => row.folderId !== op.id),
				'Children must settle before canonical folder deletion'
			);
			events.push('folder:delete');
		}
	};
	return {
		rows,
		commands,
		events,
		transport,
		generic,
		loseNext() {
			lose = true;
		}
	};
}
test('mixed local moves and deletion use dedicated theme intent atomically and keep active selection coherent', async () => {
	const f = fixture();
	try {
		const a = await f.sync.things.create({ thingtime: ['folder'], crystal: { name: 'A' } }),
			b = await f.sync.things.create({ thingtime: ['folder'], crystal: { name: 'B' } });
		const t = await f.themes.save({ name: 'Peach', theme: { colors: { accent: '#bf8068' } } });
		await f.themes.setActive(t.theme.id);
		await f.sync.things.move([a.id, t.theme.id], b.id);
		assert.equal((await f.sync.view(t.theme.id))?.folderId, b.id);
		assert.equal((await f.sync.views([a.id, t.theme.id])).length, 2);
		assert.equal(
			(await f.sync.status()).some((row) => row.id === t.theme.id),
			false
		);
		await assert.rejects(f.sync.things.move([t.theme.id, b.id], a.id), /cycle|own|descendant|itself/i);
		assert.equal((await f.sync.view(t.theme.id))?.folderId, b.id, 'failed batch rolled back the earlier theme move');
		await assert.rejects(f.sync.things.update({ id: t.theme.id, crystal: { name: 'Bypass' } }), /protected|dedicated/i);
		await f.sync.remove([a.id, t.theme.id]);
		assert.equal(await f.sync.view(t.theme.id), null);
		assert.equal((await f.themes.list()).activeThemeId, null);
		assert.equal((await f.themes.selection.status())?.desired, null);
		assert.equal((await f.themes.status()).length, 0, 'never-sent private copy needs no remote deletion');
	} finally {
		await f.db.close();
	}
});
test('folder deletion completes locally while uncertain theme edits replay and move before the remote folder delete', async () => {
	const f = fixture(),
		s = server([theme('peach', 'looks')]);
	try {
		await f.sync.remember(folder('looks'));
		await f.themes.refresh(s.transport);
		await f.themes.save({ id: 'peach', name: 'Offline edit', theme: { colors: { accent: '#bf8068' } } });
		s.loseNext();
		await f.themes.sync(s.transport);
		const frozen = structuredClone(s.commands[0]);
		await f.sync.remove(['looks']);
		assert.equal(await f.sync.view('looks'), null);
		assert.equal((await f.sync.view('peach'))?.folderId, null);
		assert.equal((await f.sync.sync(s.generic)).completed, 0);
		assert.equal(s.events.includes('folder:delete'), false);
		await f.themes.retry('peach');
		await f.themes.sync(s.transport);
		assert.deepEqual(s.commands[1], frozen);
		assert.equal(s.commands[2].folderId, null);
		assert.equal(s.rows.get('peach')?.name, 'Offline edit');
		assert.equal((await f.sync.sync(s.generic)).completed, 1);
		assert.equal(s.events.at(-1), 'folder:delete');
		// A later token edit must preserve the acknowledged root placement, not revive the old base folder.
		await f.themes.save({ id: 'peach', name: 'Another edit', theme: {} });
		await f.themes.sync(s.transport);
		assert.equal(s.rows.get('peach')?.folderId, null);
	} finally {
		await f.db.close();
	}
});
test('a late retained theme is drained to the surviving parent before a queued folder deletion sends', async () => {
	const f = fixture(),
		s = server([theme('late', 'child')]);
	try {
		await f.sync.remember(folder('parent'));
		await f.sync.remember(folder('child', 'parent'));
		await f.sync.remove(['child']);
		await f.themes.refresh(s.transport);
		assert.equal((await f.sync.sync(s.generic)).completed, 0);
		assert.equal((await f.sync.view('late'))?.folderId, 'parent');
		await f.themes.sync(s.transport);
		assert.equal(s.rows.get('late')?.folderId, 'parent');
		assert.equal((await f.sync.sync(s.generic)).completed, 1);
	} finally {
		await f.db.close();
	}
});
test('theme conflicts keep device edits and folder deletion visible until explicit review and retry', async () => {
	const f = fixture(),
		s = server([theme('peach', 'looks')]);
	try {
		await f.sync.remember(folder('looks'));
		await f.themes.refresh(s.transport);
		await f.sync.remove(['looks']);
		s.rows.set('peach', { ...s.rows.get('peach')!, name: 'Other device', version: version(20) });
		await f.themes.sync(s.transport);
		await f.sync.sync(s.generic);
		assert.equal((await f.themes.status())[0].state, 'conflict');
		assert.equal((await f.sync.status())[0].state, 'error');
		assert.equal((await f.sync.view('peach'))?.folderId, null);
		assert.equal(s.events.includes('folder:delete'), false);
		const review = await f.themes.inspect('peach', s.transport);
		await f.themes.resolve(review, 'local', s.transport);
		await f.themes.sync(s.transport);
		await f.sync.retry('looks');
		await f.sync.sync(s.generic);
		assert.equal(s.events.at(-1), 'folder:delete');
	} finally {
		await f.db.close();
	}
});

test('confirmed theme deletion retains a scope-bound tombstone against late library and catalogue results', async () => {
	const f = fixture(),
		remote = theme('peach', null),
		s = server([remote]);
	try {
		await f.themes.refresh(s.transport);
		await f.themes.setActive(remote.id);
		await f.sync.remove([remote.id]);
		assert.equal(await f.sync.isDeleted(remote.id), true);
		assert.equal((await f.themes.list()).activeThemeId, null);
		await f.themes.sync(s.transport);
		assert.equal(s.rows.has(remote.id), false);
		await f.themes.remember([remote], await f.themes.beginRead());
		assert.equal(await f.sync.view(remote.id), null);
		assert.equal(await f.sync.isDeleted(remote.id), true);
		const snapshot = await f.sync.viewSnapshot([remote.id]);
		assert.deepEqual(snapshot.rows, []);
		assert.ok(snapshot.deleted.has(remote.id));
		await f.themes.refresh(s.transport);
		assert.equal(await f.sync.isDeleted(remote.id), true);
	} finally {
		await f.db.close();
	}
});

test('custom-plane folder identities cannot adopt or drain home theme placement', async () => {
	const db = new WorkspaceDatabase(new IDBFactory()),
		custom = { ...scope, dataPlane: 'custom' },
		themes = new AccountThemeSync(db, custom, lease),
		sync = new AccountThingSync(db, custom, lease, undefined, undefined, undefined, themes),
		s = server([theme('home-theme', 'same-folder'), theme('root-theme', null)]);
	try {
		await sync.remember(folder('same-folder'));
		await themes.refresh(s.transport);
		assert.equal(await sync.view('home-theme'), null);
		await assert.rejects(sync.things.move(['root-theme'], 'same-folder'), /home library/);
		assert.equal((await sync.view('root-theme'))?.folderId, null);
		await sync.remove(['same-folder']);
		assert.equal((await sync.things.get('home-theme')).folderId, 'same-folder');
		let removed = false;
		await sync.sync({
			...s.generic,
			remove: async () => {
				removed = true;
			}
		});
		assert.equal(removed, true);
		assert.deepEqual(s.commands, []);
		assert.equal((await themes.status()).find((row) => row.id === 'home-theme')?.state, 'synced');
	} finally {
		await db.close();
	}
});
