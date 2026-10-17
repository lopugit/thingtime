import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCloudFolderService } from './folders';
import { cloudFolderMetadata } from './folderMetadata';
import { thingMutationEvent } from '../timeline/recordMutation';
import { parseCloudFolderCreate } from '../../../fileSync/cloudFolder';
const now = new Date('2026-10-17T00:00:00.000Z');
const root = () => ({
	shareId: 'root',
	ownerId: 'owner',
	thingtime: ['folder'],
	acl: ['tt:user'],
	folderId: null,
	crystal: { name: 'Root' },
	updatedAt: now
});
function fixture() {
	let docs = new Map<string, any>([['root', root()]]),
		events = new Map<string, any>(),
		creates = 0,
		effects = 0,
		charged = 0,
		failCreate = false,
		failAfterInsert = false;
	const collection = {
		async findOne(filter: any) {
			return docs.get(filter.shareId) ?? null;
		},
		find(filter: any) {
			let limit = Infinity;
			return {
				limit(n: number) {
					limit = n;
					return this;
				},
				async *[Symbol.asyncIterator]() {
					for (const doc of [...docs.values()].filter((doc) => doc.ownerId === filter.ownerId && doc.folderId === filter.folderId).slice(0, limit))
						yield doc;
				},
				async close() {}
			};
		}
	};
	const service = createCloudFolderService({
		collection: async () => collection,
		customPlane: () => false,
		now: () => now,
		transaction: async (work) => {
			const before = structuredClone(docs),
				savedEvents = structuredClone(events),
				charge = charged;
			try {
				return await work({ inTransaction: () => true });
			} catch (error) {
				docs = before;
				events = savedEvents;
				charged = charge;
				throw error;
			}
		},
		entries: (async (_things: any, owner: string, ids: string[]) => ids.flatMap((id) => (events.has(id) ? [{ event: events.get(id) }] : []))) as any,
		lock: async (_things, owner, id, session) => {
			assert.equal(owner, 'owner');
			assert.ok(docs.has(id!));
			assert.ok(session.inTransaction());
		},
		create: (async (owner: string, input: any, viewer: any, app: any, hooks: any) => {
			assert.equal(owner, 'owner');
			assert.equal(viewer.id, owner);
			assert.equal(app, null);
			assert.ok(hooks.transaction.session.inTransaction());
			creates++;
			if (failCreate) return { ok: false, status: 402, error: 'Quota exceeded' };
			const doc: any = {
				...root(),
				shareId: input.shareId,
				folderId: input.folderId,
				crystal: { name: input.crystal.name.trim() },
				updatedAt: input.createdAt
			};
			docs.set(doc.shareId, doc);
			charged++;
			if (failAfterInsert) throw Error('History unavailable');
			const event = thingMutationEvent(null, doc, hooks.timelineCapture)!;
			events.set(event.id, event);
			doc.timelineHeadId = event.id;
			hooks.transaction.afterCommit(async () => {
				effects++;
			});
			return { ok: true, doc };
		}) as any
	});
	const input = () => ({ kind: 'folder' as const, id: randomUUID(), operationId: randomUUID(), name: 'Documents', folderId: 'root' });
	return {
		service,
		input,
		docs: () => docs,
		events: () => events,
		counts: () => ({ creates, effects, charged }),
		fail: (after = false) => {
			failCreate = !after;
			failAfterInsert = after;
		}
	};
}
test('ordinary folder creation uses one atomic canonical writer and immutable Timeline receipt', async () => {
	const f = fixture(),
		input = f.input(),
		first = await f.service.create('owner', input);
	assert.equal(first.ok, true);
	assert.equal(first.replayed, false);
	assert.deepEqual(first.folder, cloudFolderMetadata(f.docs().get(input.id)));
	assert.deepEqual(f.counts(), { creates: 1, effects: 1, charged: 1 });
	f.docs().get(input.id).crystal.name = 'Edited later';
	assert.deepEqual((await f.service.create('owner', input)).folder, first.folder);
	assert.equal((await f.service.create('owner', { ...input, name: 'Different' })).status, 409);
	f.docs().delete(input.id);
	const recovered = await f.service.read('owner', input.id, input.operationId);
	assert.equal(recovered.ok, true);
	assert.deepEqual(recovered.ok === true && recovered.receipt, first.folder);
	assert.deepEqual((await f.service.create('owner', input)).folder, first.folder);
	assert.equal(f.docs().has(input.id), false);
	assert.equal(f.events().size, 1);
	assert.deepEqual(f.counts(), { creates: 1, effects: 1, charged: 1 });
});
test('foreign, public, namespaced or invalid ancestor roots do not authorize creation', async () => {
	for (const patch of [
		{ ownerId: 'other' },
		{ acl: ['tt:all'] },
		{ appId: 'app' },
		{ targetId: 'post' },
		{ sandboxSpace: 'space' },
		{ folderId: 'root' },
		{ folderId: 'missing' },
		{ thingtime: ['folder', 'file'] }
	]) {
		const f = fixture();
		Object.assign(f.docs().get('root'), patch);
		assert.equal((await f.service.create('owner', f.input())).ok, false);
		assert.equal(f.counts().creates, 0);
	}
	const f = fixture();
	f.docs().set('child', { ...root(), shareId: 'child', folderId: 'root', acl: ['tt:inherit'] });
	assert.equal((await f.service.create('owner', { ...f.input(), folderId: 'child' })).ok, true);
});
test('occupied IDs, sibling case or Unicode aliases never get adopted or overwritten', async () => {
	for (const name of ['Documents', 'documents', 'DOCUMENTS']) {
		const f = fixture();
		f.docs().set('sibling', { ...root(), shareId: 'sibling', folderId: 'root', crystal: { name } });
		assert.equal((await f.service.create('owner', f.input())).status, 409);
		assert.equal(f.counts().creates, 0);
	}
	const f = fixture(),
		input = f.input();
	f.docs().set(input.id, { ...root(), shareId: input.id });
	assert.equal((await f.service.create('owner', input)).status, 409);
	f.docs().set('sibling', { ...root(), shareId: 'sibling', folderId: 'root', crystal: { name: 'café' } });
	assert.equal((await f.service.create('owner', { ...f.input(), name: 'cafe\u0301' })).status, 409);
});
test('quota or history failure rolls back creation and does not run commit effects', async () => {
	for (const after of [false, true]) {
		const f = fixture(),
			input = f.input();
		f.fail(after);
		assert.equal((await f.service.create('owner', input)).ok, false);
		assert.equal(f.docs().has(input.id), false);
		assert.equal(f.events().size, 0);
		assert.equal(f.counts().charged, 0);
		assert.equal(f.counts().effects, 0);
	}
	const f = fixture(),
		input = { ...f.input(), name: ' Documents ' };
	assert.equal((await f.service.create('owner', input)).ok, false);
	assert.equal(f.docs().has(input.id), false);
	assert.equal(f.counts().charged, 0);
});
test('client-authored draft or foreign Timeline entries cannot impersonate folder receipts', async () => {
	for (const patch of [{ source: 'client' }, { mode: 'draft' }, { actorId: 'other' }, { operation: 'update' }]) {
		const f = fixture(),
			input = f.input(),
			created = await f.service.create('owner', input);
		assert.equal(created.ok, true);
		Object.assign([...f.events().values()][0], patch);
		assert.equal((await f.service.create('owner', input)).status, 409);
	}
});
test('folder create is closed and custom data planes never touch home storage', async () => {
	const f = fixture();
	for (const patch of [
		{ id: 'existing' },
		{ operationId: 'bad' },
		{ kind: 'file' },
		{ name: '../outside' },
		{ folderId: null },
		{ surprise: 'field' }
	])
		assert.throws(() => parseCloudFolderCreate({ ...f.input(), ...patch }));
	const service = createCloudFolderService({
		customPlane: () => true,
		collection: async () => {
			throw Error('unexpected home read');
		}
	});
	assert.equal((await service.create('owner', f.input())).status, 409);
	const denied = await service.read('owner', 'root');
	assert.equal(denied.ok === false && denied.status, 409);
});
