import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { AccountFileSync, type AccountFileTransport } from './accountFiles';
import { WorkspaceDatabase, WorkspaceError } from './storage';
import { LocalThings } from './things';
const scope = { kind: 'account' as const, origin: 'https://example.test', ownerId: 'owner', dataPlane: 'home' };
const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
function fixture() {
	const factory = new IDBFactory(),
		db = new WorkspaceDatabase(factory);
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
		await assert.rejects(f.service.things.saveFile({ ...f.input, requestId: placedRequest, folderId: folder.id }), /folder placement/);
		await f.db.transaction(scope, 'readonly', lease, async (tx) => {
			assert.equal(await tx.get('things', `local-file-${placedRequest}`), undefined);
			assert.equal(await tx.getBytes(`local-file-${placedRequest}`), undefined);
		});
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
