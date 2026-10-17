import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { AccountThingSync } from './accountSync';
import { AccountThemeSync } from './accountThemes';
import { WorkspaceDatabase } from './storage';
import { exportAccountThings } from './accountExport';
import { LocalThings } from './things';
import { bundleFromPlan } from '../utils/thingTransfer/browser';
import { parseTransfer, serializeTransfer } from '../utils/thingTransfer/format';
const scope = { kind: 'account', origin: 'https://theme-export.test', ownerId: 'owner', dataPlane: 'home' } as const;
const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
const remote = (folderId: string | null = null) => ({
	id: randomUUID(),
	name: 'Peach',
	theme: { colors: { accent: '#bb8866' } },
	visibility: 'private',
	folderId,
	version: 'theme-state-v1:' + 'a'.repeat(64),
	createdAt: '2026-10-17T00:00:00.000Z',
	updatedAt: '2026-10-17T00:00:00.000Z'
});
const fixture = () => {
	const db = new WorkspaceDatabase(new IDBFactory()),
		sync = new AccountThingSync(db, scope, lease),
		themes = new AccountThemeSync(db, scope, lease);
	return {
		db,
		sync,
		themes,
		deps: {
			db,
			sync,
			themes,
			lease,
			canRefresh: () => false,
			remote: async () => {
				throw Error('Unexpected remote request');
			}
		}
	};
};
const manifest = (plan: any) =>
	parseTransfer(serializeTransfer({ format: 'thingtime.transfer', version: 1, roots: plan.roots, things: plan.things, files: plan.files }));
test('new device themes export before sync and mixed folder transfers retain edited owned themes with independent import IDs', async () => {
	const f = fixture();
	try {
		const local = (await f.themes.save({ name: 'Local first', theme: { colors: { accent: '#885544' } } })).theme;
		const result = await exportAccountThings({ ids: [local.id] }, f.deps);
		assert.equal(manifest(result.plan).things[0].crystal.name, 'Local first');
		const folder = await f.sync.things.create({ thingtime: ['folder'], crystal: { name: 'Looks' } }),
			theme = remote(folder.id);
		await f.themes.remember([theme], await f.themes.beginRead());
		const edited = await f.themes.save({ id: theme.id, name: 'Edited peach', theme: { colors: { accent: '#226688' } } });
		const mixed = manifest((await exportAccountThings({ ids: [folder.id] }, f.deps)).plan);
		const exported = mixed.things.find((row) => row.id === theme.id)!;
		assert.equal(exported.folderId, folder.id);
		assert.deepEqual(exported.crystal, { name: 'Edited peach', theme: edited.theme.theme });
		assert.equal((exported.crystal.theme as any).colors.accent, '#226688');
		assert.equal('ownerId' in exported, false);
		assert.equal('acl' in exported, false);
		const imported = await new LocalThings(f.db, { kind: 'anonymous' }, lease).import(mixed);
		assert.notEqual(imported.idMap[theme.id], theme.id);
		const copy = await new LocalThings(f.db, { kind: 'anonymous' }, lease).get(imported.idMap[theme.id]);
		assert.equal(copy.folderId, imported.idMap[folder.id]);
		assert.deepEqual(copy.crystal, exported.crystal);
	} finally {
		await f.db.close();
	}
});
test('theme deletion invalidates prepared downloads and cannot be resurrected from retained export snapshots', async () => {
	const f = fixture();
	try {
		const theme = (await f.themes.save({ name: 'Temporary', theme: {} })).theme;
		const prepared = await exportAccountThings({ ids: [theme.id] }, f.deps);
		await f.themes.remove(theme.id);
		await assert.rejects(bundleFromPlan(prepared.plan), /no longer available/);
		await assert.rejects(exportAccountThings({ ids: [theme.id] }, f.deps));
	} finally {
		await f.db.close();
	}
});
test('remote folder completion preserves pending theme tokens and managed fallbacks cannot replace them', async () => {
	const f = fixture();
	try {
		const folder = {
			id: randomUUID(),
			thingtime: ['folder'],
			crystal: { name: 'Retained folder' },
			author: { id: scope.ownerId },
			acl: ['tt:user'],
			visibility: 'private',
			createdAt: '2026-10-17T00:00:00.000Z',
			updatedAt: '2026-10-17T00:00:00.000Z',
			revision: 1
		};
		await f.sync.remember(folder);
		const original = remote(folder.id);
		await f.themes.remember([original], await f.themes.beginRead());
		await f.themes.save({ id: original.id, name: 'Device edit', theme: { colors: { accent: '#226688' } } });
		let calls = 0;
		const deps = {
			...f.deps,
			canRefresh: () => true,
			remote: async () => {
				calls++;
				return {
					ok: true,
					plan: {
						roots: [folder.id],
						files: [],
						things: [
							{ id: folder.id, thingtime: ['folder'], crystal: folder.crystal },
							{ id: original.id, thingtime: ['theme'], crystal: { name: original.name, theme: original.theme }, folderId: folder.id }
						]
					}
				};
			}
		};
		const result = manifest((await exportAccountThings({ ids: [folder.id] }, deps)).plan);
		assert.equal(calls, 1);
		assert.equal(result.things.find((row) => row.id === original.id)!.crystal.name, 'Device edit');
		assert.equal((await exportAccountThings({ ids: [folder.id] }, f.deps)).plan.things.length, 2);
		await assert.rejects(
			exportAccountThings(
				{ ids: [folder.id], includeChildren: false },
				{
					...deps,
					remote: async () => ({
						ok: true,
						plan: { roots: [folder.id], things: [{ id: folder.id, thingtime: ['folder'], crystal: folder.crystal }], files: [{ id: 'managed-file' }] }
					})
				}
			),
			/Sync your device edits/
		);
	} finally {
		await f.db.close();
	}
});
test('upgrading old retained placement metadata preserves pending edits and export refuses unknown placement until then', async () => {
	const f = fixture();
	try {
		const original = remote();
		await f.themes.remember([original], await f.themes.beginRead());
		await f.themes.save({ id: original.id, name: 'Device edit', theme: { colors: { accent: '#885544' } } });
		await f.db.transaction(scope, 'readwrite', lease, async (tx) => {
			const state: any = await tx.get('account-theme-sync', original.id);
			delete state.placementKnown;
			delete state.base.folderId;
			await tx.put('account-theme-sync', original.id, state);
		});
		await assert.rejects(exportAccountThings({ ids: [original.id] }, f.deps), /folder placement/);
		await f.themes.remember([original], await f.themes.beginRead());
		const out = manifest((await exportAccountThings({ ids: [original.id] }, f.deps)).plan);
		assert.equal(out.things[0].crystal.name, 'Device edit');
		assert.equal((await f.themes.status())[0].state, 'pending');
	} finally {
		await f.db.close();
	}
});
test('theme export cannot borrow another owner, origin or data-plane adapter or invent cross-plane folder membership', async () => {
	const f = fixture();
	try {
		const theme = (await f.themes.save({ name: 'Mine', theme: {} })).theme;
		for (const other of [
			{ ...scope, ownerId: 'other' },
			{ ...scope, origin: 'https://other.test' },
			{ ...scope, dataPlane: 'custom' }
		])
			await assert.rejects(
				exportAccountThings({ ids: [theme.id] }, { ...f.deps, themes: new AccountThemeSync(f.db, other, lease) }),
				/different account workspaces/
			);
		const custom = { ...scope, dataPlane: 'custom' },
			sync = new AccountThingSync(f.db, custom, lease),
			themes = new AccountThemeSync(f.db, custom, lease);
		const folder = await sync.things.create({ thingtime: ['folder'], crystal: { name: 'Other database' } }),
			home = remote(folder.id);
		await themes.remember([home], await themes.beginRead());
		await assert.rejects(exportAccountThings({ ids: [folder.id] }, { ...f.deps, sync, themes }), /another database/);
		assert.equal(manifest((await exportAccountThings({ ids: [home.id] }, { ...f.deps, sync, themes })).plan).things.length, 1);
	} finally {
		await f.db.close();
	}
});
