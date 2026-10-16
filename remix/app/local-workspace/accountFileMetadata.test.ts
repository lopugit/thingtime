import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { AccountFileSync } from './accountFiles';
import { LocalThings } from './things';
import { WorkspaceDatabase, WorkspaceError } from './storage';
const scope = { kind: 'account' as const, ownerId: 'owner', origin: 'https://example.test', dataPlane: 'home' };
const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
async function fixture() {
	const factory = new IDBFactory(),
		db = new WorkspaceDatabase(factory);
	let now = Date.parse('2026-10-16T00:00:00Z'),
		version = now;
	const files = new AccountFileSync(db, scope, lease, () => now);
	const bytes = new TextEncoder().encode('Private editable file bytes');
	const local = await files.things.saveFile({ requestId: randomUUID(), name: 'file.txt', contentType: 'text/plain', bytes, purpose: 'file' });
	const remote: any = {
		id: 'remote-file',
		author: { id: scope.ownerId },
		thingtime: ['attachment'],
		crystal: { ...local.crystal },
		folderId: null,
		updatedAt: new Date(version).toISOString()
	};
	const calls: any[] = [];
	const bump = () => {
		remote.updatedAt = new Date(++version).toISOString();
	};
	const transport = {
		start: async () => ({ id: remote.id, partSizeBytes: bytes.length, partCount: 1, state: 'ready' as const }),
		parts: async () => [],
		put: async () => {},
		complete: async () => ({ id: remote.id, ...remote.crystal }),
		get: async () => structuredClone(remote),
		annotate: async (input: any) => {
			if (input.expectedUpdatedAt !== remote.updatedAt) throw new WorkspaceError('STALE', 'stale', 409);
			calls.push({ kind: 'annotate', ...input });
			for (const key of ['title', 'description', 'filenamePreview'])
				if (input[key] != null) remote.crystal[key] = input[key];
				else delete remote.crystal[key];
			bump();
			return { attachment: { id: remote.id, ...remote.crystal }, updatedAt: remote.updatedAt };
		},
		move: async (id: string, folderId: string | null, expected: string) => {
			if (expected !== remote.updatedAt) throw new WorkspaceError('STALE', 'stale', 409);
			calls.push({ kind: 'move', id, folderId });
			remote.folderId = folderId;
			bump();
		}
	};
	await files.sync(transport);
	return {
		factory,
		db,
		files,
		local,
		bytes,
		remote,
		transport,
		calls,
		bump,
		now: () => now,
		advance: () => {
			now += 120_000;
		}
	};
}
test('file details and folder changes persist offline, wait for remote folders and never repeat byte uploads', async () => {
	const f = await fixture();
	try {
		const folder = await f.files.things.create({ thingtime: ['folder'], crystal: { name: 'Folder' } });
		await f.files.things.annotateFile({ id: f.local.id, title: 'Local title', filenamePreview: 'Display name.txt' });
		await f.files.things.move([f.local.id], folder.id);
		assert.deepEqual(f.calls, []);
		await f.db.close();
		const reopened = new WorkspaceDatabase(f.factory);
		try {
			const files = new AccountFileSync(reopened, scope, lease);
			assert.equal((await files.things.readFile(f.local.id)).row.crystal.title, 'Local title');
			await files.sync(f.transport);
			assert.equal(f.remote.crystal.title, 'Local title');
			assert.equal(f.remote.folderId, null);
			assert.equal((await files.status())[0].state, 'pending');
			await files.sync(f.transport, undefined, 3, async (id) => id === folder.id);
			assert.equal(f.remote.folderId, folder.id);
			assert.equal((await files.status())[0].state, 'synced');
			assert.deepEqual(
				f.calls.map((call) => call.kind),
				['annotate', 'move']
			);
			assert.deepEqual((await files.things.readFile(f.local.id)).bytes, f.bytes);
		} finally {
			await reopened.close();
		}
	} finally {
		await f.db.close();
	}
});
test('lost annotation receipts reconcile the frozen write before sending a newer local edit', async () => {
	const f = await fixture();
	try {
		await f.files.things.annotateFile({ id: f.local.id, title: 'First local title' });
		let lost = true;
		const transport = {
			...f.transport,
			annotate: async (input: any) => {
				const result = await f.transport.annotate(input);
				if (lost) {
					lost = false;
					throw new WorkspaceError('LOST', 'lost reply', 503);
				}
				return result;
			}
		};
		await f.files.sync(transport);
		assert.equal((await f.files.status())[0].state, 'pending');
		await f.files.things.annotateFile({ id: f.local.id, title: 'Newer local title' });
		f.advance();
		await f.files.sync(transport);
		assert.equal(f.remote.crystal.title, 'Newer local title');
		assert.deepEqual(
			f.calls.map((call) => call.title),
			['First local title', 'Newer local title']
		);
		assert.equal((await f.files.status())[0].state, 'synced');
	} finally {
		await f.db.close();
	}
});
test('unrelated account changes merge while concurrent edits require a fresh reviewed choice', async () => {
	const f = await fixture();
	try {
		await f.files.things.annotateFile({ id: f.local.id, title: 'Device title' });
		f.remote.crystal.description = 'Account description';
		f.bump();
		await f.files.sync(f.transport);
		assert.equal((await f.files.things.readFile(f.local.id)).row.crystal.description, 'Account description');
		await f.files.things.annotateFile({ id: f.local.id, title: 'New device title' });
		f.remote.crystal.title = 'Concurrent account title';
		f.bump();
		await f.files.sync(f.transport);
		assert.equal((await f.files.status())[0].state, 'conflict');
		await assert.rejects(f.files.retry(f.local.id), /Compare/);
		const review = await f.files.metadata.inspect(f.transport, f.local.id);
		const choice = {
			id: review.id,
			remoteId: review.remoteId,
			localRevision: review.localRevision,
			remoteUpdatedAt: review.remote.updatedAt,
			keep: 'local' as const
		};
		await f.files.things.annotateFile({ id: f.local.id, description: 'Typed during review' });
		await assert.rejects(f.files.metadata.resolve(f.transport, choice), /device file changed/);
		const next = await f.files.metadata.inspect(f.transport, f.local.id);
		f.bump();
		await assert.rejects(f.files.metadata.resolve(f.transport, { ...choice, localRevision: next.localRevision }), /account file changed/);
		const final = await f.files.metadata.inspect(f.transport, f.local.id);
		await f.files.metadata.resolve(f.transport, { ...choice, localRevision: final.localRevision, remoteUpdatedAt: final.remote.updatedAt });
		await f.files.sync(f.transport);
		assert.equal(f.remote.crystal.title, 'New device title');
		assert.equal(f.remote.crystal.description, 'Typed during review');
		assert.deepEqual((await f.files.things.readFile(f.local.id)).bytes, f.bytes);
	} finally {
		await f.db.close();
	}
});
test('metadata claims isolate tabs and preserve edits made while a conditional write is in flight', async () => {
	const f = await fixture();
	try {
		await f.files.things.annotateFile({ id: f.local.id, title: 'Frozen' });
		let release!: () => void, entered!: () => void;
		const waiting = new Promise<void>((resolve) => {
				release = resolve;
			}),
			started = new Promise<void>((resolve) => {
				entered = resolve;
			});
		let first = true;
		const transport = {
			...f.transport,
			annotate: async (input: any) => {
				if (first) {
					first = false;
					entered();
					await waiting;
				}
				return f.transport.annotate(input);
			}
		};
		const active = f.files.sync(transport);
		await started;
		const other = new AccountFileSync(f.db, scope, lease, f.now);
		await other.sync(transport);
		assert.equal(f.calls.length, 0);
		await other.things.annotateFile({ id: f.local.id, title: 'Edited during upload' });
		release();
		await active;
		assert.equal(f.remote.crystal.title, 'Edited during upload');
		assert.deepEqual(
			f.calls.map((call) => call.title),
			['Frozen', 'Edited during upload']
		);
	} finally {
		await f.db.close();
	}
});
test('permission errors, identity mismatches and unsupported account paths preserve device metadata', async () => {
	const f = await fixture();
	try {
		await f.files.things.annotateFile({ id: f.local.id, title: 'Keep me' });
		await f.files.sync({
			...f.transport,
			annotate: async () => {
				throw new WorkspaceError('DENIED', 'denied', 403);
			}
		});
		assert.equal((await f.files.status())[0].state, 'error');
		await f.files.sync(f.transport);
		assert.equal(f.calls.length, 0);
		await f.files.retry(f.local.id);
		await f.files.sync({ ...f.transport, get: async () => ({ ...f.remote, author: { id: 'other' } }) });
		assert.equal((await f.files.status())[0].state, 'error');
		assert.equal(f.calls.length, 0);
		assert.equal((await f.files.things.readFile(f.local.id)).row.crystal.title, 'Keep me');
		await assert.rejects(new LocalThings(f.db, scope, lease).annotateFile({ id: f.local.id, title: 'Bypass' }), /dedicated/);
		await assert.rejects(new LocalThings(f.db, scope, lease).move([f.local.id], null), /dedicated/);
		for (const other of [
			{ ...scope, ownerId: 'other' },
			{ ...scope, dataPlane: 'other' }
		])
			assert.deepEqual(await new AccountFileSync(f.db, other, lease).metadata.status(), []);
	} finally {
		await f.db.close();
	}
});

test('initial folder intent and original save identity survive later filing and annotation', async () => {
	const f = await fixture();
	try {
		const folder = await f.files.things.create({ thingtime: ['folder'], crystal: { name: 'Later folder' } });
		await f.files.things.move([f.local.id], folder.id);
		await f.files.things.annotateFile({ id: f.local.id, title: 'Retained title' });
		const replay = await f.files.things.saveFile({
			requestId: f.local.localAttachment.requestId!,
			name: 'file.txt',
			contentType: 'text/plain',
			bytes: f.bytes,
			purpose: 'file'
		});
		assert.equal(replay.folderId, folder.id);
		assert.equal(replay.crystal.title, 'Retained title');
		await assert.rejects(
			f.files.things.saveFile({
				requestId: f.local.localAttachment.requestId!,
				name: 'file.txt',
				contentType: 'text/plain',
				bytes: f.bytes,
				folderId: folder.id
			}),
			/already used/
		);
		await assert.rejects(f.files.things.annotateFile({ id: f.local.id, title: 'Discard no fields', unexpected: true } as any), /Unsupported/);
	} finally {
		await f.db.close();
	}
});
test('queue admission failure rolls back local annotation and aborted replies cannot overwrite later edits', async () => {
	const f = await fixture();
	try {
		const wrapped = new Proxy(f.db, {
			get(target, key) {
				if (key !== 'transaction') return Reflect.get(target, key);
				return (scope: any, mode: any, lease: any, work: any) =>
					target.transaction(scope, mode, lease, (tx) =>
						work({
							...tx,
							put: async (collection: string, id: string, value: unknown) => {
								if (collection === 'account-file-metadata') throw new WorkspaceError('LOCAL_QUOTA', 'Full', 413);
								return tx.put(collection, id, value);
							}
						})
					);
			}
		});
		await assert.rejects(new AccountFileSync(wrapped, scope, lease).things.annotateFile({ id: f.local.id, title: 'Must roll back' }), /Full/);
		assert.equal((await f.files.things.readFile(f.local.id)).row.crystal.title, undefined);
		await f.files.things.annotateFile({ id: f.local.id, title: 'Before cancellation' });
		const controller = new AbortController();
		let finish!: (value: unknown) => void, entered!: () => void;
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const running = f.files.sync(
			{
				...f.transport,
				get: async () => {
					entered();
					return new Promise((resolve) => {
						finish = resolve;
					});
				}
			},
			controller.signal
		);
		await started;
		controller.abort();
		await running;
		await f.files.things.annotateFile({ id: f.local.id, title: 'After cancellation' });
		finish(structuredClone(f.remote));
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.equal((await f.files.things.readFile(f.local.id)).row.crystal.title, 'After cancellation');
		assert.equal(f.calls.length, 0);
		f.advance();
		await f.files.sync(f.transport);
		assert.equal(f.remote.crystal.title, 'After cancellation');
	} finally {
		await f.db.close();
	}
});

test('keeping reviewed account details updates only metadata and refuses a substituted file identity', async () => {
	const f = await fixture();
	try {
		await f.files.things.annotateFile({ id: f.local.id, title: 'Device value' });
		f.remote.crystal.title = 'Account value';
		f.bump();
		await f.files.sync(f.transport);
		const review = await f.files.metadata.inspect(f.transport, f.local.id);
		const choice = {
			id: f.local.id,
			remoteId: review.remoteId,
			localRevision: review.localRevision,
			remoteUpdatedAt: review.remote.updatedAt,
			keep: 'remote' as const
		};
		await assert.rejects(f.files.metadata.resolve(f.transport, { ...choice, remoteId: 'another-file' }), /Review this file/);
		await f.files.metadata.resolve(f.transport, choice);
		assert.equal((await f.files.status())[0].state, 'synced');
		const read = await f.files.things.readFile(f.local.id);
		assert.equal(read.row.crystal.title, 'Account value');
		assert.deepEqual(read.bytes, f.bytes);
		assert.equal(f.calls.length, 0);
	} finally {
		await f.db.close();
	}
});

test('deletion pauses metadata even when a prior worker already resolved the remote identity or started its read', async () => {
	for (const inFlight of [false, true]) {
		const f = await fixture();
		try {
			await f.files.things.annotateFile({ id: f.local.id, title: 'Pending device detail' });
			let release = () => {}, entered = () => {};
			const blocked = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
			if (!inFlight) await f.files.remove(f.local.id);
			const syncing = f.files.metadata.sync({ ...f.transport, get: async () => { entered(); await blocked; return f.transport.get(); } }, async () => f.remote.id, async () => true);
			if (inFlight) { await started; await f.files.remove(f.local.id); }
			release(); await syncing;
			assert.deepEqual(f.calls, []);
			assert.equal((await f.files.status())[0].phase, 'delete');
			await assert.rejects(f.files.things.readFile(f.local.id), (error: any) => error.status === 404);
		} finally { await f.db.close(); }
	}
});
