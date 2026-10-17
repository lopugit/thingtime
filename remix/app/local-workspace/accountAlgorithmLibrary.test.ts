import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { AccountAlgorithmSync, type AccountAlgorithmSnapshot, type AccountAlgorithmTransport } from './accountAlgorithms';
import { AccountThingSync, type AccountSyncTransport } from './accountSync';
import { exportAccountThings } from './accountExport';
import { accountImportSupported } from './accountImport';
import { LocalThings } from './things';
import { WorkspaceDatabase, WorkspaceError } from './storage';
import { parseTransfer, serializeTransfer, type ThingTransfer } from '../utils/thingTransfer/format';

const scope = { kind: 'account', ownerId: 'owner', origin: 'https://algorithm-library.test', dataPlane: 'home' } as const;
const stamp = '2026-10-18T00:00:00.000Z';
const version = (n: number) => 'algorithm-state-v1:' + n.toString(16).padStart(64, '0');
const content = {
	name: 'Reading',
	emoji: '🧠',
	weights: { types: { text: 1 }, tags: { kindness: 2 }, authors: {} },
	eventCount: 3,
	lastTrainedAt: stamp
};
const bundle = (): ThingTransfer => ({
	format: 'thingtime.transfer',
	version: 1,
	roots: ['folder'],
	files: [],
	things: [
		{ id: 'folder', thingtime: ['folder'], crystal: { name: 'Reading profiles' } },
		{ id: 'profile', thingtime: ['feed-algorithm'], crystal: structuredClone(content), folderId: 'folder' }
	]
});
const folder = (id: string) => ({
	id,
	thingtime: ['folder'],
	crystal: { name: id },
	createdAt: stamp,
	updatedAt: stamp,
	revision: 1,
	author: { id: scope.ownerId },
	acl: ['tt:user'],
	visibility: 'private'
});
function fixture(ownerId = 'owner') {
	let live = true;
	const lease = {
		assertCurrent() {
			if (!live) throw new WorkspaceError('WORKSPACE_CHANGED', 'Changed account', 409);
		},
		onInvalidate: () => () => {}
	};
	const db = new WorkspaceDatabase(new IDBFactory());
	const algorithms = new AccountAlgorithmSync(db, { ...scope, ownerId }, lease);
	const sync = new AccountThingSync(db, { ...scope, ownerId }, lease, undefined, undefined, undefined, undefined, algorithms);
	return {
		db,
		algorithms,
		sync,
		lease,
		canRefresh: () => false,
		remote: async () => {
			throw Error('No remote export allowed');
		},
		retire() {
			live = false;
		}
	};
}
function server(initial: AccountAlgorithmSnapshot[] = []) {
	let serial = 10,
		lose = false;
	const rows = new Map(initial.map((row) => [row.id, structuredClone(row)])),
		calls: any[] = [],
		receipts = new Map<string, any>(),
		events: string[] = [];
	const transport: AccountAlgorithmTransport = {
		snapshot: async () => structuredClone([...rows.values()]),
		write: async (command) => {
			calls.push(structuredClone(command));
			let ack = receipts.get(command.writeId);
			if (!ack) {
				const before = rows.get(command.id);
				assert.equal(command.expectedVersion, before?.version ?? null);
				const resultVersion = command.action === 'delete' ? null : version(++serial);
				if (command.action === 'delete') rows.delete(command.id);
				else
					rows.set(command.id, {
						id: command.id,
						content: command.content,
						description: command.description,
						parentId: null,
						shared: false,
						listed: false,
						folderId: command.folderId === undefined ? before?.folderId ?? null : command.folderId,
						legacy: false,
						createdAt: stamp,
						updatedAt: stamp,
						version: resultVersion!
					});
				ack = { id: command.id, action: command.action, writeId: command.writeId, expectedVersion: command.expectedVersion, resultVersion };
				receipts.set(command.writeId, ack);
			}
			if (lose) {
				lose = false;
				throw Error('Lost response');
			}
			return ack;
		}
	};
	const generic: AccountSyncTransport = {
		get: async () => {
			throw { status: 404 };
		},
		write: async () => {
			throw Error('Protected profile must never use generic writer');
		},
		remove: async (op) => {
			assert.ok([...rows.values()].every((row) => row.folderId !== op.id));
			events.push('folder:delete');
		}
	};
	return {
		transport,
		generic,
		rows,
		calls,
		events,
		loseNext() {
			lose = true;
		}
	};
}
const manifest = (plan: any) =>
	parseTransfer(serializeTransfer({ format: 'thingtime.transfer', version: 1, roots: plan.roots, things: plan.things, files: plan.files }));

test('normal account import and offline export round-trip private inactive algorithm content with remapped folder IDs', async (t) => {
	const f = fixture(),
		other = fixture('other');
	t.after(async () => {
		await f.db.close();
		await other.db.close();
	});
	assert.equal(accountImportSupported(bundle()), true);
	const imported = await f.sync.things.import(bundle());
	assert.notEqual(imported.idMap.profile, 'profile');
	assert.notEqual(imported.idMap.folder, 'folder');
	const row = (await f.sync.view(imported.idMap.profile))!;
	assert.equal(row.folderId, imported.idMap.folder);
	assert.deepEqual(row.acl, ['tt:user']);
	assert.equal(row.author.id, 'owner');
	assert.equal((await f.algorithms.list()).activeAlgorithmId, null);
	assert.deepEqual(
		(await f.sync.status()).map((row) => row.id),
		[imported.idMap.folder]
	);
	const out = manifest((await exportAccountThings({ ids: imported.roots }, f)).plan);
	assert.deepEqual(out.things.find((row) => row.id === imported.idMap.profile)!.crystal, content);
	assert.doesNotMatch(serializeTransfer(out), /"author"|"acl"|"visibility"|"writeId"|"parentId"|"shared"|"listed"/);
	const copy = await other.sync.things.import(out);
	const copied = (await other.sync.view(copy.idMap[row.id]))!;
	assert.notEqual(copied.id, row.id);
	assert.equal(copied.author.id, 'other');
	assert.equal(copied.folderId, copy.idMap[imported.idMap.folder]);
	assert.equal((await other.algorithms.list()).activeAlgorithmId, null);
	await assert.rejects(f.sync.things.update({ id: row.id, crystal: { name: 'Bypass' } }), /protected|dedicated/i);
	await assert.rejects(new LocalThings(f.db, scope, f.lease).import(bundle()), /dedicated/i);
});

test('local import and moves complete while only profile synchronization waits for the folder receipt', async (t) => {
	const f = fixture(),
		s = server();
	t.after(() => f.db.close());
	const imported = await f.sync.things.import(bundle());
	assert.equal((await f.algorithms.sync(s.transport)).completed, 0);
	assert.equal(s.calls.length, 0);
	const destination = await f.sync.things.create({ thingtime: ['folder'], crystal: { name: 'Destination' } });
	await f.sync.things.move([imported.idMap.profile], destination.id);
	assert.equal((await f.sync.view(imported.idMap.profile))!.folderId, destination.id);
	await f.algorithms.sync(s.transport);
	assert.equal(s.calls.length, 0);
	await f.sync.things.move([imported.idMap.profile], null);
	assert.equal((await f.algorithms.sync(s.transport)).completed, 1);
	assert.equal(s.rows.get(imported.idMap.profile)!.folderId, null);
});

test('folder removal completes locally while an uncertain profile write replays before its newer root placement', async (t) => {
	const f = fixture(),
		s = server([
			{
				id: 'profile',
				content,
				description: '',
				parentId: null,
				shared: false,
				listed: false,
				folderId: 'folder',
				legacy: false,
				createdAt: stamp,
				updatedAt: stamp,
				version: version(1)
			}
		]);
	t.after(() => f.db.close());
	await f.sync.remember(folder('folder'));
	await f.algorithms.refresh(s.transport);
	await f.algorithms.algorithms.update({ id: 'profile', name: 'Edited offline' });
	s.loseNext();
	await f.algorithms.sync(s.transport);
	const frozen = structuredClone(s.calls[0]);
	await f.sync.remove(['folder']);
	assert.equal(await f.sync.view('folder'), null);
	assert.equal((await f.sync.view('profile'))!.folderId, null);
	assert.equal((await f.sync.sync(s.generic)).completed, 0);
	await f.algorithms.retry('profile');
	await f.algorithms.sync(s.transport);
	assert.deepEqual(s.calls[1], frozen);
	assert.equal(s.calls[2].folderId, null);
	assert.equal(s.rows.get('profile')!.content.name, 'Edited offline');
	assert.equal((await f.sync.sync(s.generic)).completed, 1);
	await f.algorithms.algorithms.update({ id: 'profile', name: 'Another edit' });
	await f.algorithms.sync(s.transport);
	assert.equal(s.rows.get('profile')!.folderId, null, 'acknowledged root placement never revives the old folder');
});

test('prepared algorithm exports are revoked on deletion or account change and reject mismatched adapters', async (t) => {
	const f = fixture(),
		other = fixture('other');
	t.after(async () => {
		await f.db.close();
		await other.db.close();
	});
	const first = await f.algorithms.algorithms.create({ name: 'First' });
	const prepared = await exportAccountThings({ ids: [first.algorithm.id] }, f);
	await f.sync.remove([first.algorithm.id]);
	await assert.rejects(prepared.plan.assertCurrent());
	const second = await f.algorithms.algorithms.create({ name: 'Second' });
	await assert.rejects(exportAccountThings({ ids: [second.algorithm.id] }, { ...f, algorithms: other.algorithms }), /different.*workspaces/);
	assert.throws(() => new AccountThingSync(f.db, scope, f.lease, undefined, undefined, undefined, undefined, other.algorithms), /workspace/i);
	const current = await exportAccountThings({ ids: [second.algorithm.id] }, f);
	f.retire();
	await assert.rejects(current.plan.assertCurrent(), /Changed account/);
});

test('conflict resolution preserves the chosen device folder and independent copies keep their placement', async (t) => {
	const f = fixture(),
		s = server([
			{
				id: 'profile',
				content,
				description: '',
				parentId: null,
				shared: false,
				listed: false,
				folderId: 'original-folder',
				legacy: false,
				createdAt: stamp,
				updatedAt: stamp,
				version: version(1)
			}
		]);
	t.after(() => f.db.close());
	await f.algorithms.refresh(s.transport);
	await f.algorithms.algorithms.update({ id: 'profile', name: 'Device edit' });
	s.rows.set('profile', { ...s.rows.get('profile')!, folderId: 'remote-folder', version: version(2) });
	const conflicting = {
		...s.transport,
		write: async () => {
			throw { status: 409 };
		}
	};
	await f.algorithms.sync(conflicting);
	const review = await f.algorithms.inspect('profile', s.transport);
	await f.algorithms.resolve(review, 'local', s.transport);
	await f.algorithms.sync(s.transport);
	assert.equal(s.rows.get('profile')!.folderId, 'original-folder');
	assert.equal((await f.algorithms.status())[0].remoteFolderId, 'original-folder');
	await f.algorithms.algorithms.update({ id: 'profile', name: 'Independent variant' });
	await f.algorithms.sync(conflicting);
	const copyReview = await f.algorithms.inspect('profile', s.transport);
	const { copyId } = await f.algorithms.resolve(copyReview, 'copy', s.transport);
	assert.ok(copyId);
	assert.equal((await f.sync.view(copyId))!.folderId, 'original-folder');
	await f.algorithms.sync(s.transport);
	assert.equal(s.rows.get(copyId)!.folderId, 'original-folder');
	assert.equal(s.rows.get(copyId)!.parentId, null);
});
