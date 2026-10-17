import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { AccountThemeSync, ACCOUNT_THEME_SYNC, ACCOUNT_THEME_CATALOG, type AccountThemeState } from './accountThemes';
import { ACCOUNT_THEME_SELECTION, type AccountThemeSelectionState } from './themeSelection';
import { migrateSelectedThemesHome, migrateAccountThemesHome } from './homeThemeMigration';
import { WorkspaceDatabase, type WorkspaceScope, type WorkspaceTransaction } from './storage';
import { MAX_SAVED_THEMES } from '../theme/savedTheme';
const selected = { kind: 'account', origin: 'https://home-migration.example', ownerId: 'owner', dataPlane: 'custom-' + 'a'.repeat(64) } as const;
const home = { ...selected, dataPlane: 'home' };
const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
const fixture = () => new WorkspaceDatabase(new IDBFactory(), 'migration', 1000, IDBKeyRange);
const tx = <T>(db: WorkspaceDatabase, scope: WorkspaceScope, run: (transaction: WorkspaceTransaction) => Promise<T>) =>
	db.transaction(scope, 'readwrite', lease, run);
const read = (db: WorkspaceDatabase, scope: WorkspaceScope, collection: string, id: string) =>
	db.transaction(scope, 'readonly', lease, (t) => t.get<any>(collection, id));
const snapshot = (db: WorkspaceDatabase, scope: WorkspaceScope) =>
	db.transaction(scope, 'readonly', lease, async (t) => ({
		things: await t.list('things'),
		states: await t.list(ACCOUNT_THEME_SYNC),
		settings: await t.list('settings'),
		usage: await t.usage()
	}));

test('legacy content, later edits, selection and exact receipt context move in one home transaction', async () => {
	const db = fixture(),
		source = new AccountThemeSync(db, selected, lease, () => 1000, randomUUID),
		target = new AccountThemeSync(db, home, lease, () => 200000, randomUUID);
	try {
		const theme = (await source.save({ name: 'Original', theme: {} })).theme;
		const ticket = await target.beginRead();
		await source.sync({
			snapshot: async () => [],
			write: async () => {
				throw Error('Lost response');
			}
		});
		await source.selection.refresh({
			selection: async () => ({ themeId: null, version: 'theme-selection-v1:' + 'a'.repeat(64) }),
			select: async () => {
				throw Error('Unused');
			}
		});
		await source.setActive(theme.id);
		await source.selection.sync(
			{
				selection: async () => {
					throw Error('Unused');
				},
				select: async () => {
					throw Error('Lost response');
				}
			},
			async () => true
		);
		await tx(db, selected, async (t) => {
			const state = (await t.get<AccountThemeState>(ACCOUNT_THEME_SYNC, theme.id))!;
			delete state.pending!.receiptPlane;
			await t.put(ACCOUNT_THEME_SYNC, theme.id, state);
			const choice = (await t.get<AccountThemeSelectionState>('settings', ACCOUNT_THEME_SELECTION))!;
			delete choice.pending!.receiptPlane;
			await t.put('settings', ACCOUNT_THEME_SELECTION, choice);
			await t.put('things', 'ordinary', { id: 'ordinary', thingtime: ['data'], crystal: { value: 'keep selected' } });
		});
		await source.save({ id: theme.id, name: 'Later device edit', theme: {} });
		const before = (await source.status())[0],
			choice = await source.selection.status();
		const foreignScopes = [{ ...home, ownerId: 'other' }, { ...home, origin: 'https://other.example' }, { kind: 'anonymous' }] as const;
		for (const scope of foreignScopes) await tx(db, scope, (t) => t.put('things', theme.id, { secret: 'untouched fixture' }));
		const result = await migrateSelectedThemesHome(db, selected, lease, 200000);
		assert.deepEqual(result, { moved: [theme.id], deduplicated: [], selectionMoved: true, issues: [] });
		assert.equal((await target.list()).themes[0].name, 'Later device edit');
		assert.equal((await target.list()).activeThemeId, theme.id);
		const moved = (await target.status())[0];
		assert.deepEqual(moved, { ...before, pending: { ...before.pending, receiptPlane: selected.dataPlane } });
		assert.deepEqual(await target.selection.status(), { ...choice, pending: { ...choice!.pending, receiptPlane: selected.dataPlane } });
		assert.equal(await read(db, selected, 'things', theme.id), undefined);
		assert.equal((await read(db, selected, 'things', 'ordinary')).crystal.value, 'keep selected');
		for (const scope of foreignScopes) assert.deepEqual(await read(db, scope, 'things', theme.id), { secret: 'untouched fixture' });
		assert.equal(await target.remember([], ticket), false, 'a pre-migration catalogue read cannot erase migrated content');
		const after = await snapshot(db, home);
		await migrateSelectedThemesHome(db, selected, lease, 200000);
		assert.deepEqual(await snapshot(db, home), after);
		const sent: unknown[] = [];
		await target.sync({
			snapshot: async () => [],
			write: async (command, _signal, plane) => {
				sent.push({ command, plane });
				throw Error('Still uncertain');
			}
		});
		assert.deepEqual(sent, [{ command: before.pending!.command, plane: selected.dataPlane }]);
	} finally {
		await db.close();
	}
});

test('competing versions, in-flight claims, generic collisions and dependents stay intact in their source', async () => {
	for (const reason of ['different-device-version', 'in-flight', 'identity-collision', 'local-dependencies'] as const) {
		const db = fixture(),
			source = new AccountThemeSync(
				db,
				selected,
				lease,
				() => 1000,
				() => '123e4567-e89b-42d3-a456-426614174000'
			),
			target = new AccountThemeSync(
				db,
				home,
				lease,
				() => 1000,
				() => '123e4567-e89b-42d3-a456-426614174000'
			);
		try {
			const item = (await source.save({ name: 'Source edit', theme: {} })).theme;
			await source.setActive(item.id);
			if (reason === 'different-device-version') await target.save({ name: 'Home edit', theme: {} });
			if (reason === 'in-flight')
				await tx(db, selected, async (t) => {
					const s = await t.get<any>(ACCOUNT_THEME_SYNC, item.id);
					await t.put(ACCOUNT_THEME_SYNC, item.id, { ...s, claim: { token: 'active', expiresAt: 9000 } });
				});
			if (reason === 'identity-collision')
				await tx(db, home, (t) => t.put('things', item.id, { id: item.id, thingtime: ['data'], crystal: { value: 'home data' } }));
			if (reason === 'local-dependencies')
				await tx(db, selected, (t) => t.put('things', 'dependent', { id: 'dependent', thingtime: ['comment'], crystal: {}, targetId: item.id }));
			const beforeSource = await snapshot(db, selected),
				beforeHome = await snapshot(db, home);
			const result = await migrateSelectedThemesHome(db, selected, lease, 2000);
			assert.deepEqual(result.moved, []);
			assert.equal(result.selectionMoved, false);
			assert.equal(result.issues[0].reason, reason);
			assert.equal(result.issues[1].reason, 'unresolved-theme');
			assert.deepEqual(await snapshot(db, selected), beforeSource);
			assert.deepEqual(await snapshot(db, home), beforeHome);
		} finally {
			await db.close();
		}
	}
});

test('expired claims preserve their token, command and explicit receipt identity for exact retry', async () => {
	const db = fixture(),
		source = new AccountThemeSync(db, selected, lease, () => 1000, randomUUID);
	try {
		const item = (await source.save({ name: 'Pending', theme: {} })).theme;
		await source.sync({
			snapshot: async () => [],
			write: async () => {
				throw Error('lost');
			}
		});
		await tx(db, selected, async (t) => {
			const s = await t.get<any>(ACCOUNT_THEME_SYNC, item.id);
			s.claim = { token: 'expired', expiresAt: 1500 };
			await t.put(ACCOUNT_THEME_SYNC, item.id, s);
		});
		const before = (await source.status())[0];
		await migrateSelectedThemesHome(db, selected, lease, 2000);
		assert.deepEqual(await read(db, home, ACCOUNT_THEME_SYNC, item.id), before, 'explicit home context and all other frozen metadata remain exact');
	} finally {
		await db.close();
	}
});

test('home theme quota failure rolls back source removal, selection and both accounting ledgers', async () => {
	const db = fixture(),
		source = new AccountThemeSync(db, selected, lease, () => 1000, randomUUID),
		target = new AccountThemeSync(db, home, lease, () => 1000, randomUUID);
	try {
		for (let i = 0; i < MAX_SAVED_THEMES; i++) await target.save({ name: 'Home ' + i, theme: {} });
		const item = (await source.save({ name: 'Source', theme: {} })).theme;
		await source.setActive(item.id);
		const a = await snapshot(db, selected),
			b = await snapshot(db, home);
		await assert.rejects(migrateSelectedThemesHome(db, selected, lease, 2000), /theme limit/);
		assert.deepEqual(await snapshot(db, selected), a);
		assert.deepEqual(await snapshot(db, home), b);
	} finally {
		await db.close();
	}
});

test('concurrent selected-plane migrations serialize home writes without dropping either copy', async () => {
	const db = fixture(),
		second = { ...selected, dataPlane: 'custom-' + 'b'.repeat(64) },
		id = '123e4567-e89b-42d3-a456-426614174000';
	try {
		const a = new AccountThemeSync(
				db,
				selected,
				lease,
				() => 1000,
				() => id
			),
			b = new AccountThemeSync(
				db,
				second,
				lease,
				() => 1000,
				() => id
			);
		await a.save({ name: 'First plane', theme: {} });
		await b.save({ name: 'Second plane', theme: {} });
		const results = await Promise.all([migrateSelectedThemesHome(db, selected, lease), migrateSelectedThemesHome(db, second, lease)]);
		assert.equal(
			results.reduce((n, r) => n + r.moved.length, 0),
			1
		);
		assert.equal(
			results.reduce((n, r) => n + r.issues.length, 0),
			1
		);
		const names = [];
		for (const scope of [home, selected, second]) {
			const row = await read(db, scope, 'things', id);
			if (row) names.push(row.crystal.name);
		}
		assert.deepEqual(names.sort(), ['First plane', 'Second plane']);
	} finally {
		await db.close();
	}
});

test('migration is account-only, home is a no-op, and malformed pending commands stay in place', async () => {
	const db = fixture(),
		source = new AccountThemeSync(db, selected, lease, () => 1000, randomUUID);
	try {
		await assert.rejects(migrateSelectedThemesHome(db, { kind: 'anonymous' } as any, lease), /Confirm/);
		assert.deepEqual(await migrateSelectedThemesHome(db, home, lease), { moved: [], deduplicated: [], selectionMoved: false, issues: [] });
		const item = (await source.save({ name: 'Bad retry', theme: {} })).theme;
		await tx(db, selected, async (t) => {
			const s = await t.get<any>(ACCOUNT_THEME_SYNC, item.id);
			await t.put(ACCOUNT_THEME_SYNC, item.id, { ...s, pending: { command: { action: 'save', ownerId: 'forged' }, revision: 1 } });
		});
		const before = await snapshot(db, selected);
		const result = await migrateSelectedThemesHome(db, selected, lease);
		assert.equal(result.issues[0].reason, 'invalid-state');
		assert.deepEqual(await snapshot(db, selected), before);
		assert.equal(await read(db, home, ACCOUNT_THEME_SYNC, item.id), undefined);
	} finally {
		await db.close();
	}
});

test('equivalent acknowledged caches deduplicate without replacing the home revision or selection', async () => {
	const db = fixture(),
		source = new AccountThemeSync(db, selected, lease, () => 1000, randomUUID),
		target = new AccountThemeSync(db, home, lease, () => 2000, randomUUID);
	try {
		const remote = {
			id: randomUUID(),
			name: 'Shared cache',
			theme: {},
			visibility: 'private',
			folderId: null,
			title: null,
			version: 'theme-state-v1:' + 'a'.repeat(64),
			createdAt: '2026-10-18T00:00:00.000Z',
			updatedAt: '2026-10-18T00:00:00.000Z'
		};
		const choice = { themeId: remote.id, version: 'theme-selection-v1:' + 'a'.repeat(64) };
		for (const adapter of [source, target]) {
			await adapter.remember([remote], await adapter.beginRead());
			await adapter.selection.refresh({
				selection: async () => choice,
				select: async () => {
					throw Error('Unused');
				}
			});
		}
		const before = await read(db, home, 'things', remote.id),
			state = await read(db, home, ACCOUNT_THEME_SYNC, remote.id),
			selection = await target.selection.status();
		const result = await migrateSelectedThemesHome(db, selected, lease);
		assert.deepEqual(result, { moved: [], deduplicated: [remote.id], selectionMoved: true, issues: [] });
		assert.deepEqual(await read(db, home, 'things', remote.id), before);
		assert.deepEqual(await read(db, home, ACCOUNT_THEME_SYNC, remote.id), state);
		assert.deepEqual(await target.selection.status(), selection);
		assert.equal((await source.list()).themes.length, 0);
		assert.equal(await source.selection.status(), undefined);
	} finally {
		await db.close();
	}
});

test('competing local selections remain explicit even when their independent theme can move', async () => {
	const db = fixture(),
		source = new AccountThemeSync(db, selected, lease, () => 1000, randomUUID),
		target = new AccountThemeSync(db, home, lease, () => 1000, randomUUID);
	try {
		const a = (await source.save({ name: 'Source choice', theme: {} })).theme,
			b = (await target.save({ name: 'Home choice', theme: {} })).theme;
		await source.setActive(a.id);
		await target.setActive(b.id);
		const first = await source.selection.status(),
			second = await target.selection.status();
		const result = await migrateSelectedThemesHome(db, selected, lease);
		assert.deepEqual(result.moved, [a.id]);
		assert.equal(result.selectionMoved, false);
		assert.deepEqual(result.issues, [{ kind: 'selection', id: ACCOUNT_THEME_SELECTION, reason: 'different-device-version' }]);
		assert.deepEqual(await source.selection.status(), first);
		assert.deepEqual(await target.selection.status(), second);
		assert.equal((await target.list()).themes.length, 2);
	} finally {
		await db.close();
	}
});

test('an old tab writing again is discovered on the next migration and never hidden by a completion marker', async () => {
	const db = fixture(),
		source = new AccountThemeSync(db, selected, lease, () => 1000, randomUUID);
	try {
		const first = (await source.save({ name: 'Earlier', theme: {} })).theme;
		await migrateSelectedThemesHome(db, selected, lease);
		const later = (await source.save({ name: 'Old tab continued', theme: {} })).theme;
		const result = await migrateSelectedThemesHome(db, selected, lease);
		assert.deepEqual(result.moved, [later.id]);
		assert.ok(await read(db, home, 'things', first.id));
		assert.ok(await read(db, home, 'things', later.id));
	} finally {
		await db.close();
	}
});

test('home opening discovers other selected-plane caches without visiting or connecting to those databases', async () => {
	const db = fixture(),
		otherPlane = { ...selected, dataPlane: 'custom-' + 'b'.repeat(64) },
		foreign = { ...selected, ownerId: 'other' };
	try {
		const ids = [];
		for (const scope of [selected, otherPlane, foreign])
			ids.push((await new AccountThemeSync(db, scope, lease, () => 1000, randomUUID).save({ name: scope.dataPlane, theme: {} })).theme.id);
		const foreignBefore = await snapshot(db, foreign);
		const result = await migrateAccountThemesHome(db, home, lease);
		assert.deepEqual(result.map((row) => row.dataPlane).sort(), [selected.dataPlane, otherPlane.dataPlane].sort());
		assert.deepEqual(result.flatMap((row) => row.result.moved).sort(), ids.slice(0, 2).sort());
		assert.equal((await new AccountThemeSync(db, home, lease).list()).themes.length, 2);
		assert.deepEqual(await snapshot(db, foreign), foreignBefore);
		assert.equal(await read(db, home, 'things', ids[2]), undefined);
	} finally {
		await db.close();
	}
});

test('an uncertain deletion moves only its tombstone and frozen receipt, never recreating the content', async () => {
	const db = fixture(),
		source = new AccountThemeSync(db, selected, lease, () => 1000, randomUUID);
	try {
		const item = (await source.save({ name: 'Delete later', theme: {} })).theme;
		await source.sync({
			snapshot: async () => [],
			write: async (command) => ({
				id: command.id,
				writeId: command.writeId,
				action: command.action,
				expectedVersion: command.expectedVersion,
				resultVersion: 'theme-state-v1:' + 'a'.repeat(64)
			})
		});
		await source.remove(item.id);
		await source.sync({
			snapshot: async () => [],
			write: async () => {
				throw Error('Lost deletion reply');
			}
		});
		await tx(db, selected, async (t) => {
			const state = (await t.get<AccountThemeState>(ACCOUNT_THEME_SYNC, item.id))!;
			delete state.pending!.receiptPlane;
			await t.put(ACCOUNT_THEME_SYNC, item.id, state);
		});
		const before = (await source.status())[0];
		assert.equal(before.deleted, true);
		assert.equal(before.pending!.command.action, 'delete');
		await migrateSelectedThemesHome(db, selected, lease, 200000);
		assert.equal(await read(db, home, 'things', item.id), undefined);
		assert.deepEqual(await read(db, home, ACCOUNT_THEME_SYNC, item.id), {
			...before,
			pending: { ...before.pending, receiptPlane: selected.dataPlane }
		});
		assert.equal(await read(db, selected, ACCOUNT_THEME_SYNC, item.id), undefined);
	} finally {
		await db.close();
	}
});

test('migration preserves filed themes and never rebinds them to an unrelated same-ID home folder', async () => {
 const db=fixture(),source=new AccountThemeSync(db,selected,lease,()=>1000,randomUUID);
 try {
  const theme=(await source.save({name:'Filed device theme',theme:{}})).theme;
  await tx(db,selected,async t=>{
   const row=await t.get<any>('things',theme.id);
   await t.put('things',theme.id,{...row,folderId:'folder'});
   await t.put('things','folder',{id:'folder',thingtime:['folder'],crystal:{name:'Selected folder'}});
  });
  await tx(db,home,t=>t.put('things','folder',{id:'folder',thingtime:['folder'],crystal:{name:'Different home folder'}}));
  const before=await snapshot(db,selected),homeBefore=await snapshot(db,home);
  const result=await migrateSelectedThemesHome(db,selected,lease,200000);
  assert.deepEqual(result.issues,[{kind:'theme',id:theme.id,reason:'local-dependencies'}]);
  assert.deepEqual(await snapshot(db,selected),before);
  assert.deepEqual(await snapshot(db,home),homeBefore);
  // A dangling parent is not permission to flatten or detach the saved theme.
  await tx(db,selected,t=>t.delete('things','folder'));
  await tx(db,home,t=>t.delete('things','folder'));
  const dangling=await snapshot(db,selected);
  assert.equal((await migrateSelectedThemesHome(db,selected,lease,200000)).issues[0].reason,'local-dependencies');
  assert.deepEqual(await snapshot(db,selected),dangling);
 } finally {await db.close();}
});
