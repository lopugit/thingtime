import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { AccountFileSync, type AccountFileTransport } from './accountFiles';
import { WorkspaceDatabase, WorkspaceError, WORKSPACE_LIMITS } from './storage';
import { LocalThings } from './things';
const scope = { kind: 'account' as const, origin: 'https://example.test', ownerId: 'owner', dataPlane: 'home' };
const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
function fixture() {
	const factory = new IDBFactory(),
		db = new WorkspaceDatabase(factory, undefined, undefined, IDBKeyRange);
	let now = 1000;
	const service = new AccountFileSync(db, scope, lease, () => now),
		bytes = new TextEncoder().encode('A complete editable file'),
		calls: { kind: string; value: any }[] = [];
	const input = { requestId: randomUUID(), name: 'example.txt', contentType: 'text/plain', bytes, purpose: 'file' as const };
	const remote = { id: 'remote-file', name: input.name, size: bytes.length, contentType: 'text/plain', mediaKind: 'file' as const };
	const transport: AccountFileTransport = {
		start: async (request) => {
			calls.push({ kind: 'start', value: request });
			return { id: remote.id, partSizeBytes: 8, partCount: Math.ceil(bytes.length / 8) };
		},
		parts: async (id, parts) => {
			calls.push({ kind: 'parts', value: { id, parts } });
			return parts.map((part) => ({
				...part,
				url: `https://uploads.example.test/${part.partNumber}?secret=bearer`,
				expiresAt: '2026-10-16',
				headers: { 'x-amz-checksum-sha256': part.checksumSha256 }
			}));
		},
		put: async (part, body) => {
			calls.push({ kind: 'put', value: { number: part.partNumber, body: Array.from(body) } });
		},
		complete: async (id) => {
			calls.push({ kind: 'complete', value: id });
			return remote;
		}
	};
	return {
		factory,
		db,
		service,
		bytes,
		input,
		remote,
		transport,
		calls,
		advance: (ms = 2000) => {
			now += ms;
		}
	};
}
test('account file bytes and immutable intent commit locally and remain account scoped', async () => {
	const f = fixture();
	try {
		const row = await f.service.things.saveFile(f.input);
		assert.deepEqual((await f.service.things.readFile(row.id)).bytes, f.bytes);
		assert.equal((await f.service.status())[0].state, 'pending');
		assert.deepEqual(f.calls, []);
		assert.equal((await f.service.things.saveFile(f.input)).id, row.id);
		await assert.rejects(f.service.things.saveFile({ ...f.input, name: 'different.txt' }), /already used/);
		const folder = await f.service.things.create({ thingtime: ['folder'], crystal: { name: 'Device folder' } });
		const placedRequest = randomUUID();
		const placed = await f.service.things.saveFile({ ...f.input, requestId: placedRequest, folderId: folder.id });
		assert.equal(placed.folderId, folder.id);
		assert.equal((await f.service.metadata.status()).find(row => row.id === placed.id)?.state, 'pending');
		await assert.rejects(new LocalThings(f.db, scope, lease).saveFile({ ...f.input, requestId: randomUUID() }), /dedicated sync/);
		assert.throws(() => new AccountFileSync(f.db, { kind: 'anonymous' } as any, lease), /never synchronize/);
		for (const other of [
			{ ...scope, ownerId: 'other' },
			{ ...scope, origin: 'https://other.test' },
			{ ...scope, dataPlane: 'other' }
		])
			assert.deepEqual(await new AccountFileSync(f.db, other, lease).status(), []);
		await f.db.close();
		const reopened = new WorkspaceDatabase(f.factory);
		try {
			assert.equal((await new AccountFileSync(reopened, scope, lease).status())[0].state, 'pending');
		} finally {
			await reopened.close();
		}
	} finally {
		await f.db.close();
	}
});
test('multipart upload retains exact bytes and metadata, persists no signed URLs and maps the authorized result', async () => {
	const f = fixture();
	try {
		const row = await f.service.things.saveFile(f.input);
		assert.equal((await f.service.sync(f.transport)).completed, 1);
		assert.equal(await f.service.remoteId(row.id), f.remote.id);
		assert.equal((await f.service.status())[0].state, 'synced');
		assert.deepEqual(
			f.calls.filter((c) => c.kind === 'put').flatMap((c) => c.value.body),
			Array.from(f.bytes)
		);
		assert.deepEqual(f.calls.find((c) => c.kind === 'start')!.value, {
			requestId: f.input.requestId,
			filename: 'example.txt',
			contentType: 'text/plain',
			sizeBytes: f.bytes.length,
			purpose: 'file'
		});
		await f.db.transaction(scope, 'readonly', lease, async (tx) =>
			assert.equal(JSON.stringify(await tx.list('account-files')).includes('bearer'), false)
		);
		assert.equal((await f.service.sync(f.transport)).completed, 0);
	} finally {
		await f.db.close();
	}
});
test('lost completion receipts retry completion only, never duplicate uploads or abandon device bytes', async () => {
	const f = fixture();
	try {
		const row = await f.service.things.saveFile(f.input);
		let completed = 0;
		const transport = {
			...f.transport,
			complete: async () => {
				if (++completed === 1) throw new WorkspaceError('LOST', 'lost response', 503);
				return f.remote;
			}
		};
		await f.service.sync(transport);
		assert.equal((await f.service.status())[0].phase, 'complete');
		assert.equal(await f.service.remoteId(row.id), null);
		const putCount = f.calls.filter((c) => c.kind === 'put').length;
		f.advance();
		await f.service.sync(transport);
		assert.equal(completed, 2);
		assert.equal(f.calls.filter((c) => c.kind === 'start').length, 1);
		assert.equal(f.calls.filter((c) => c.kind === 'put').length, putCount);
		assert.equal(await f.service.remoteId(row.id), f.remote.id);
	} finally {
		await f.db.close();
	}
});
test('only explicit canonical retry codes return an uncertain finalization to upload', async () => {
	const f = fixture();
	try {
		await f.service.things.saveFile(f.input);
		let completed = 0;
		const transport = {
			...f.transport,
			complete: async () => {
				if (++completed === 1) throw { status: 409, code: 'upload_parts_retryable', retryable: true };
				return f.remote;
			}
		};
		await f.service.sync(transport);
		assert.equal((await f.service.status())[0].phase, 'upload');
		f.advance();
		await f.service.sync(transport);
		assert.equal(completed, 2);
		assert.equal(f.calls.filter((c) => c.kind === 'start').length, 1);
		assert.equal(f.calls.filter((c) => c.kind === 'put').length, Math.ceil(f.bytes.length / 8) * 2);
	} finally {
		await f.db.close();
	}
});
test('upload permission refusals and mismatched receipts preserve local files with visible errors', async () => {
	const f = fixture();
	try {
		const row = await f.service.things.saveFile(f.input);
		await f.service.sync({
			...f.transport,
			start: async () => {
				throw { status: 403 };
			}
		});
		assert.equal((await f.service.status())[0].state, 'error');
		assert.deepEqual((await f.service.things.readFile(row.id)).bytes, f.bytes);
		await f.service.retry(row.id);
		await f.service.sync({ ...f.transport, complete: async () => ({ ...f.remote, id: 'another-account-file' }) });
		assert.equal((await f.service.status())[0].state, 'error');
		assert.equal(await f.service.remoteId(row.id), null);
	} finally {
		await f.db.close();
	}
});
test('tabs claim each file once and aborted late responses cannot complete another attempt', async () => {
	const f = fixture();
	try {
		const row = await f.service.things.saveFile(f.input);
		let entered!: () => void, finish!: (value: any) => void;
		const began = new Promise<void>((r) => (entered = r)),
			held = new Promise<any>((r) => (finish = r)),
			controller = new AbortController();
		const first = f.service.sync(
			{
				...f.transport,
				start: async () => {
					entered();
					return held;
				}
			},
			controller.signal
		);
		await began;
		const other = new AccountFileSync(f.db, scope, lease, () => 1000);
		assert.equal((await other.sync(f.transport)).completed, 0);
		controller.abort();
		await assert.rejects(first, /abort/i); // The next iteration observes the caller's cancellation.
		assert.equal(await f.service.remoteId(row.id), null);
		f.advance();
		await f.service.sync(f.transport);
		finish({ id: 'late', partSizeBytes: 8, partCount: 3 });
		await new Promise((r) => setTimeout(r, 0));
		assert.equal(await f.service.remoteId(row.id), f.remote.id);
	} finally {
		await f.db.close();
	}
});

test('a queue quota failure rolls back both file content and bytes', async () => {
	const f = fixture();
	try {
		const wrapped = new Proxy(f.db, {
			get(target, key) {
				if (key !== 'transaction') return Reflect.get(target, key);
				return (scope: any, mode: any, lease: any, run: any) =>
					target.transaction(scope, mode, lease, (tx) =>
						run({
							...tx,
							put: async (collection: string, id: string, value: unknown) => {
								if (collection === 'account-files') throw new WorkspaceError('LOCAL_QUOTA', 'Full', 413);
								return tx.put(collection, id, value);
							}
						})
					);
			}
		});
		const service = new AccountFileSync(wrapped, scope, lease);
		await assert.rejects(service.things.saveFile(f.input), /Full/);
		await f.db.transaction(scope, 'readonly', lease, async (tx) => {
			assert.deepEqual(await tx.list('things'), []);
			assert.deepEqual(await tx.list('account-files'), []);
			assert.equal(await tx.getBytes('local-file-' + f.input.requestId), undefined);
		});
	} finally {
		await f.db.close();
	}
});
test('invalid upload plans fail before PUT and server retry timing is retained', async () => {
	const f = fixture();
	try {
		await f.service.things.saveFile(f.input);
		await f.service.sync({ ...f.transport, start: async () => ({ id: 'bad', partSizeBytes: 8, partCount: 100 }) });
		assert.equal(f.calls.filter((row) => row.kind === 'put').length, 0);
		f.advance();
		await f.service.sync({
			...f.transport,
			start: async () => {
				throw { status: 429, retryAfterMs: 90_000 };
			}
		});
		assert.equal((await f.service.status())[0].retryAt, 93000);
	} finally {
		await f.db.close();
	}
});


test('never-started cancellation is local, durable, scoped and prevents the original save replay', async () => {
	const f = fixture();
	try {
		const row = await f.service.things.saveFile(f.input);
		await f.service.cancel(row.id); await f.service.cancel(row.id);
		assert.deepEqual(await f.service.status(), []);
		await assert.rejects(f.service.things.readFile(row.id), /not stored/);
		await assert.rejects(f.service.things.saveFile(f.input), /cancelled/);
		await f.service.sync(f.transport); assert.deepEqual(f.calls, []);
		const other = new AccountFileSync(f.db, { ...scope, ownerId: 'other' }, lease);
		assert.ok(await other.things.saveFile(f.input));
	} finally { await f.db.close(); }
});

test('ambiguous starts cancel by original request after reopening; only a durable receipt releases bytes', async () => {
	const f = fixture();
	try {
		const row = await f.service.things.saveFile(f.input);
		await f.service.sync({ ...f.transport, start: async () => { throw Error('Lost start response'); } });
		await f.service.cancel(row.id);
		assert.equal((await f.service.status())[0].phase, 'cancel');
		assert.deepEqual((await f.service.things.readFile(row.id)).bytes, f.bytes);
		await f.db.close();
		const db = new WorkspaceDatabase(f.factory), service = new AccountFileSync(db, scope, lease, () => 1000);
		try {
			await service.sync({ ...f.transport, cancel: async (requestId) => {
				assert.equal(requestId, f.input.requestId); return { cancelled: true, deferred: true, retryAt: '2026-10-24T00:00:00.000Z' };
			} });
			assert.deepEqual(await service.status(), []);
			await assert.rejects(service.things.readFile(row.id), /not stored/);
			await assert.rejects(service.things.saveFile(f.input), /cancelled/);
			assert.deepEqual(f.calls, []);
		} finally { await db.close(); }
	} finally { await f.db.close(); }
});

test('cancellation supersedes an in-flight tab claim; its late start response cannot upload bytes', async () => {
	const f = fixture();
	try {
		const row = await f.service.things.saveFile(f.input);
		let release!: () => void, started!: () => void;
		const entering = new Promise<void>(r => { started = r; }), wait = new Promise<void>(r => { release = r; });
		const run = f.service.sync({ ...f.transport, start: async () => { started(); await wait; return { id: 'remote-file', partSizeBytes: 8, partCount: Math.ceil(f.bytes.length / 8) }; } });
		await entering;
		const otherTab = new AccountFileSync(f.db, scope, lease, () => 1000);
		await otherTab.cancel(row.id);
		await otherTab.sync({ ...f.transport, cancel: async () => ({ cancelled: true, deferred: false }) });
		release(); await run;
		assert.deepEqual(f.calls, []); assert.deepEqual(await f.service.status(), []);
		await assert.rejects(f.service.things.readFile(row.id), /not stored/);
	} finally { await f.db.close(); }
});

test('refused or legacy cancellation keeps bytes; finalized and editor-bound files cannot be cancelled', async () => {
	const f = fixture();
	try {
		const row = await f.service.things.saveFile(f.input);
		await f.service.sync({ ...f.transport, start: async () => { throw Error('Lost start'); } });
		await f.service.cancel(row.id);
		await f.service.sync({ ...f.transport, cancel: async () => ({ deferred: false } as any) });
		assert.deepEqual((await f.service.things.readFile(row.id)).bytes, f.bytes);
		f.advance();
		await f.service.sync({ ...f.transport, cancel: async () => { throw new WorkspaceError('upload_already_finalized', 'Already ready', 409); } });
		assert.equal((await f.service.status())[0].state, 'error');
		assert.deepEqual((await f.service.things.readFile(row.id)).bytes, f.bytes);
		const ready = await f.service.things.saveFile({ ...f.input, requestId: randomUUID() });
		await f.service.sync(f.transport); await assert.rejects(f.service.cancel(ready.id), /finished uploading/);
		const post = await f.service.things.saveFile({ ...f.input, requestId: randomUUID(), purpose: 'post' });
		await assert.rejects(f.service.cancel(post.id), /owning editor/);
	} finally { await f.db.close(); }
});


test('full device quota still admits and completes never-started or queued cancellation', async () => {
	for (const started of [false, true]) {
		const f = fixture();
		try {
			const row = await f.service.things.saveFile(f.input);
			if (started) {
				await f.service.sync({ ...f.transport, start: async () => { throw Error('Lost start response'); } });
				await f.service.retry(row.id);
			}
			await f.db.transaction(scope, 'readwrite', lease, async tx => {
				let remaining = WORKSPACE_LIMITS.bytes - (await tx.usage()).bytes, part = 0;
				while (remaining > 0) {
					const size = Math.min(remaining, WORKSPACE_LIMITS.binaryBytes);
					await tx.putBytes(`quota-fill-${part++}`, new Uint8Array(size)); remaining -= size;
				}
				assert.equal((await tx.usage()).bytes, WORKSPACE_LIMITS.bytes);
			});
			await f.service.cancel(row.id);
			if (started) await f.service.sync({ ...f.transport, cancel: async () => ({ cancelled: true, deferred: false }) });
			assert.deepEqual(await f.service.status(), []);
			await assert.rejects(f.service.things.readFile(row.id), /not stored/);
		} finally { await f.db.close(); }
	}
});

async function completedFileFixture() {
	const f = fixture(), local = await f.service.things.saveFile(f.input);
	await f.service.sync(f.transport);
	let version = 1;
	const remote: any = { id: f.remote.id, author: { id: scope.ownerId }, thingtime: ['attachment'], crystal: { ...local.crystal }, updatedAt: new Date(version).toISOString() };
	const transport = { ...f.transport, get: async () => structuredClone(remote), annotate: async () => {}, move: async () => {}, remove: async (input: any) => {
		f.calls.push({ kind: 'delete', value: input }); return { deleted: true as const, deferred: false };
	} };
	return { ...f, local, account: remote, deletionTransport: transport, bump: () => { remote.updatedAt = new Date(++version).toISOString(); } };
}
test('completed file deletion commits offline, preserves recovery bytes and freezes retries through lost acknowledgement', async () => {
	const f = await completedFileFixture();
	try {
		await f.service.remove(f.local.id);
		await assert.rejects(f.service.things.get(f.local.id), (error: any) => error.status === 404);
		assert.equal(await f.service.remoteId(f.local.id), null);
		assert.equal((await f.service.status())[0].phase, 'delete');
		assert.equal(f.calls.filter(x => x.kind === 'delete').length, 0);
		let lost = true;
		const transport = { ...f.deletionTransport, remove: async (input: any) => { const result = await f.deletionTransport.remove(input); if (lost) { lost = false; throw new WorkspaceError('LOST', 'lost', 503); } return result; } };
		await f.service.sync(transport);
		await f.db.transaction(scope, 'readonly', lease, async tx => assert.ok(await tx.getBytes(f.local.id)));
		const first = f.calls.find(x => x.kind === 'delete')!.value;
		f.bump(); f.advance();
		await f.service.sync({ ...transport, get: async () => { throw Error('Must retry the frozen deletion'); } });
		assert.deepEqual(f.calls.filter(x => x.kind === 'delete').map(x => x.value), [first, first]);
		assert.equal((await f.service.status()).length, 0);
		await f.db.transaction(scope, 'readonly', lease, async tx => assert.equal(await tx.getBytes(f.local.id), undefined));
		await assert.rejects(f.service.things.saveFile(f.input), /cancelled/);
	} finally { await f.db.close(); }
});

test('changed account file requires review; stale review cannot delete and keeping restores the device snapshot', async () => {
	const f = await completedFileFixture();
	try {
		await f.service.remove(f.local.id);
		f.account.crystal.title = 'Other device edit'; f.bump();
		await f.service.sync(f.deletionTransport);
		assert.equal((await f.service.status())[0].state, 'conflict');
		assert.equal(f.calls.filter(x => x.kind === 'delete').length, 0);
		await assert.rejects(f.service.retry(f.local.id), /Review/);
		const review = await f.service.inspectDeletion(f.deletionTransport, f.local.id);
		const choice = { id: review.id, localRevision: review.localRevision, remoteUpdatedAt: review.remote.updatedAt, operationVersion: review.operationVersion, keep: 'delete' as const };
		f.bump(); await assert.rejects(f.service.resolveDeletion(f.deletionTransport, choice), /changed/);
		const next = await f.service.inspectDeletion(f.deletionTransport, f.local.id);
		await f.service.resolveDeletion(f.deletionTransport, { ...choice, remoteUpdatedAt: next.remote.updatedAt, keep: 'file' });
		assert.deepEqual((await f.service.things.readFile(f.local.id)).bytes, f.bytes);
		assert.equal((await f.service.status())[0].state, 'synced');
		await f.service.remove(f.local.id); await f.service.sync(f.deletionTransport);
		const last = await f.service.inspectDeletion(f.deletionTransport, f.local.id);
		await f.service.resolveDeletion(f.deletionTransport, { ...choice, remoteUpdatedAt: last.remote.updatedAt });
		await f.service.sync(f.deletionTransport);
		assert.equal((await f.service.status()).length, 0);
		assert.equal(f.calls.filter(x => x.kind === 'delete').length, 1);
	} finally { await f.db.close(); }
});

for (const response of [{ deferred: false }, { deleted: true }, null]) test(`file deletion requires a durable receipt: ${JSON.stringify(response)}`, async () => {
	const f = await completedFileFixture();
	try {
		await f.service.remove(f.local.id);
		await f.service.sync({ ...f.deletionTransport, remove: async () => response as any });
		assert.equal((await f.service.status())[0].state, 'pending');
		await f.db.transaction(scope, 'readonly', lease, async tx => assert.ok(await tx.getBytes(f.local.id)));
	} finally { await f.db.close(); }
});

test('deletion and reviewed restore work at the exact device quota and survive reopening', async () => {
	const f = await completedFileFixture();
	try {
		await f.db.transaction(scope, 'readwrite', lease, async tx => {
			let remaining = WORKSPACE_LIMITS.bytes - (await tx.usage()).bytes, part = 0;
			while (remaining > 0) { const size = Math.min(remaining, WORKSPACE_LIMITS.binaryBytes); await tx.putBytes(`delete-fill-${part++}`, new Uint8Array(size)); remaining -= size; }
			assert.equal((await tx.usage()).bytes, WORKSPACE_LIMITS.bytes);
		});
		await f.service.remove(f.local.id);
		f.account.crystal.title = 'Concurrent edit'; f.bump();
		await f.service.sync(f.deletionTransport);
		await f.db.close();
		const reopened = new WorkspaceDatabase(f.factory, undefined, undefined, IDBKeyRange), files = new AccountFileSync(reopened, scope, lease);
		try {
			assert.equal((await files.status())[0].state, 'conflict');
			const review = await files.inspectDeletion(f.deletionTransport, f.local.id);
			await files.resolveDeletion(f.deletionTransport, { id: review.id, localRevision: review.localRevision, remoteUpdatedAt: review.remote.updatedAt, operationVersion: review.operationVersion, keep: 'file' });
			assert.deepEqual((await files.things.readFile(f.local.id)).bytes, f.bytes);
			await reopened.transaction(scope, 'readwrite', lease, async tx => {
				const remaining = WORKSPACE_LIMITS.bytes - (await tx.usage()).bytes;
				if (remaining) await tx.putBytes('refill-after-restore', new Uint8Array(remaining));
			});
			await files.remove(f.local.id); await files.sync(f.deletionTransport);
			const next = await files.inspectDeletion(f.deletionTransport, f.local.id);
			await files.resolveDeletion(f.deletionTransport, { id: next.id, localRevision: next.localRevision, remoteUpdatedAt: next.remote.updatedAt, operationVersion: next.operationVersion, keep: 'delete' });
			await files.sync(f.deletionTransport);
			assert.deepEqual(await files.status(), []);
		} finally { await reopened.close(); }
	} finally { await f.db.close(); }
});

test('a deletion read 404 still requires a durable account receipt and a racing account change needs review', async () => {
	const f = await completedFileFixture();
	try {
		await f.service.remove(f.local.id);
		let deletes = 0;
		await f.service.sync({ ...f.deletionTransport, get: async () => { throw new WorkspaceError('MISSING', 'missing', 404); }, remove: async input => {
			deletes++; assert.equal(input.expectedUpdatedAt, new Date(0).toISOString()); throw new WorkspaceError('STALE', 'changed', 409);
		} });
		assert.equal(deletes, 1); assert.equal((await f.service.status())[0].state, 'conflict');
		await f.db.transaction(scope, 'readonly', lease, async tx => assert.ok(await tx.getBytes(f.local.id)));
	} finally { await f.db.close(); }
});
