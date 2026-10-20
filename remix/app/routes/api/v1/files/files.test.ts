import test from 'node:test';
import assert from 'node:assert/strict';
import { createFilesHandlers } from './_files';
import { createApiCapabilitiesManifest } from '~/docs/apiDocs';
import { thingtimeCapabilityManifest } from '~/api/utils/capabilities/thingtimeCapabilities';

test('file routes use private full-account access, bounded same-origin JSON and fail-closed limits', async () => {
	let user: any = { id: 'owner', accountKind: 'user' },
		allowed = true,
		calls = 0;
	const handlers = createFilesHandlers({
		folders: {} as any,
		getUser: async () => user,
		limit: async () => ({ allowed, unavailable: !allowed } as any),
		inventory: async () => {
			throw Error('unexpected inventory');
		},
		service: {
			async read(owner: string, id: string, op?: string) {
				calls++;
				assert.equal(owner, 'owner');
				assert.equal(id, 'file');
				assert.equal(op, 'operation');
				return { ok: true, receipt: null };
			},
			async commit() {
				calls++;
				return { ok: true, replayed: true };
			}
		} as any
	});
	const request = (method = 'GET', extra: Record<string, string> = {}, body?: string) =>
		new Request('https://example.test/api/v1/files?id=file&operationId=operation', {
			method,
			headers: { Origin: 'https://example.test', 'Content-Type': 'application/json', ...extra },
			body
		});
	const read = await handlers.loader({ request: request() });
	assert.equal(read.status, 200);
	assert.match(read.headers.get('cache-control')!, /private.*no-store/);
	assert.equal((await handlers.action({ request: request('POST', { Origin: 'https://foreign.test' }, '{}') })).status, 403);
	assert.equal((await handlers.action({ request: request('POST', { 'Content-Type': 'text/plain' }, '{}') })).status, 415);
	await assert.rejects(
		handlers.action({ request: request('POST', {}, JSON.stringify({ value: 'x'.repeat(8192) })) }),
		(error: any) => error instanceof Response && error.status === 413
	);
	const before = calls;
	user = null;
	assert.equal((await handlers.loader({ request: request() })).status, 401);
	user = { id: 'service', accountKind: 'service' };
	assert.equal((await handlers.action({ request: request('POST', {}, '{}') })).status, 401);
	user = { id: 'owner', accountKind: 'user' };
	allowed = false;
	assert.equal((await handlers.action({ request: request('POST', {}, '{}') })).status, 503);
	assert.equal(calls, before);
});

test('file capability registers the real read and commit route', () => {
	const manifest = thingtimeCapabilityManifest('https://example.test');
	assert.equal(manifest.features['api.files'].version, '1.7.0');
	assert.equal(createApiCapabilitiesManifest().features['api.files'], '1.7.0');
	assert.ok(manifest.operations.some((op) => op.path === '/api/v1/files' && op.methods.includes('GET') && op.methods.includes('POST')));
});

test('inventory routing is private, full-account, rate-limited and rejects mixed or duplicate selectors', async () => {
	let calls = 0,
		user: any = { id: 'owner', accountKind: 'user' },
		allowed = true;
	const handlers = createFilesHandlers({
		folders: {} as any,
		getUser: async () => user,
		limit: async () => ({ allowed, unavailable: !allowed } as any),
		service: {} as any,
		inventory: async (owner, root) => {
			calls++;
			assert.equal(owner, 'owner');
			assert.equal(root, 'folder');
			return { ok: true, inventory: {} } as any;
		}
	});
	const request = (query = 'rootId=folder') => new Request('https://example.test/api/v1/files?' + query);
	const result = await handlers.loader({ request: request() });
	assert.equal(result.status, 200);
	assert.match(result.headers.get('cache-control')!, /private.*no-store/);
	for (const query of ['rootId=folder&id=file', 'rootId=folder&rootId=other', 'rootId=folder&cursor=next', 'rootId=folder&operationId=operation'])
		assert.equal((await handlers.loader({ request: request(query) })).status, 400);
	user = null;
	assert.equal((await handlers.loader({ request: request() })).status, 401);
	user = { id: 'owner', accountKind: 'service' };
	assert.equal((await handlers.loader({ request: request() })).status, 401);
	user.accountKind = 'user';
	allowed = false;
	assert.equal((await handlers.loader({ request: request() })).status, 503);
	assert.equal(calls, 1);
});

test('folder reads/creates use the same private account and request guards', async () => {
	let calls = 0;
	const handlers = createFilesHandlers({
		getUser: async () => ({ id: 'owner', accountKind: 'user' } as any),
		limit: async () => ({ allowed: true } as any),
		inventory: async () => {
			throw Error('wrong inventory');
		},
		service: {} as any,
		folders: {
			read: async (owner: string, id: unknown, op: unknown) => {
				assert.equal(owner, 'owner');
				assert.equal(id, 'folder');
				assert.equal(op, 'operation');
				calls++;
				return { ok: true, receipt: null };
			},
			create: async (owner: string, body: unknown) => {
				assert.equal(owner, 'owner');
				assert.equal((body as any).kind, 'folder');
				calls++;
				return { ok: true, folder: {} };
			}
		} as any
	});
	const request = (query: string) => new Request('https://example.test/api/v1/files?' + query);
	assert.equal((await handlers.loader({ request: request('folderId=folder&operationId=operation') })).status, 200);
	for (const query of [
		'folderId=folder&id=file',
		'folderId=folder&folderId=other',
		'folderId=folder&operationId=a&operationId=b',
		'folderId=folder&rootId=root'
	])
		assert.equal((await handlers.loader({ request: request(query) })).status, 400);
	const response = await handlers.action({
		request: new Request('https://example.test/api/v1/files', {
			method: 'POST',
			headers: { Origin: 'https://example.test', 'Content-Type': 'application/json' },
			body: JSON.stringify({ kind: 'folder' })
		})
	});
	assert.equal(response.status, 200);
	assert.match(response.headers.get('cache-control')!, /private.*no-store/);
	assert.equal(calls, 2);
});

test('retained receipt selectors are explicit and cannot silently fall back to publication', async () => {
 let calls = 0;
 const handlers = createFilesHandlers({ getUser: async () => ({ id: 'owner', accountKind: 'user' } as any),
  limit: async () => ({ allowed: true } as any), inventory: {} as any, folders: {} as any,
  service: { read: async (owner: string, id: string, operationId: string, retained: boolean) => {
   assert.deepEqual([owner, id, operationId, retained], ['owner', 'file', 'op', true]); calls++; return { ok: true, receipt: null };
  }, commit: async (_owner: string, body: any) => { assert.equal(body.kind, 'retained-version'); calls++; return { ok: true, retained: true }; } } as any });
 const request = (query: string) => new Request('https://example.test/api/v1/files?' + query);
 const response = await handlers.loader({ request: request('id=file&operationId=op&kind=retained-version') });
 assert.equal(response.status, 200); assert.match(response.headers.get('cache-control')!, /private.*no-store/);
 for (const query of ['id=file&kind=retained-version', 'id=file&operationId=op&kind=unknown', 'id=file&id=other', 'id=file&operationId=op&operationId=other',
  'id=file&operationId=op&kind=retained-version&kind=retained-version', 'id=file&unknown=x'])
  assert.equal((await handlers.loader({ request: request(query) })).status, 400);
 const posted = await handlers.action({ request: new Request('https://example.test/api/v1/files', { method: 'POST',
  headers: { Origin: 'https://example.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'retained-version' }) }) });
 assert.equal(posted.status, 200); assert.equal(calls, 2);
});


test('path observations require explicit selectors and preserve unavailable-path errors', async () => {
 let calls = 0, allowed = true, user: any = { id: 'owner', accountKind: 'user' };
 const handlers = createFilesHandlers({ getUser: async () => user, limit: async () => ({ allowed, unavailable: !allowed } as any),
  service: {} as any, folders: {} as any, inventory: async () => { throw Error('No full tree scan expected'); },
  path: async (owner, root, path) => { calls++; assert.deepEqual([owner, root, path], ['owner', 'folder', 'nested/file']);
   return { ok: false, status: 409, error: 'Ambiguous path' }; } });
 const req = (query = 'rootId=folder&path=nested%2Ffile') => ({ request: new Request('https://example.test/api/v1/files?' + query) });
 const result = await handlers.loader(req()); assert.equal(result.status, 409);
 assert.match(result.headers.get('cache-control')!, /private.*no-store/);
 for (const query of ['rootId=folder&path=a&path=b', 'path=a', 'rootId=folder&path=a&id=file', 'rootId=folder&path=a&operationId=op', 'rootId=folder&rootId=other&path=a'])
  assert.equal((await handlers.loader(req(query))).status, 400);
 user.accountKind = 'service'; assert.equal((await handlers.loader(req())).status, 401);
 user.accountKind = 'user'; allowed = false; assert.equal((await handlers.loader(req())).status, 503);
 assert.equal(calls, 1);
});

test('paged inventories retain private authentication/rate guards and strict selectors', async () => {
	let calls = 0, user: any = { id: 'owner', accountKind: 'user' }, allowed = true;
	const handlers = createFilesHandlers({ getUser: async () => user, limit: async () => ({ allowed, unavailable: !allowed } as any),
		folders: {} as any, service: {} as any, inventory: async () => { throw Error('wrong transport'); },
		pages: async (owner, root, emit) => { assert.equal(owner, 'owner'); assert.equal(root, 'root'); calls++;
			await emit({ version: 1, rootId: 'root', rootRevision: 'r1', generation: 'g1', ordinal: 0, nodes: [], totalEntries: 0 }); } });
	const request = (query = 'rootId=root&pages=1') => new Request('https://example.test/api/v1/files?' + query);
	const response = await handlers.loader({ request: request() });
	assert.equal(response.status, 200); assert.match(response.headers.get('content-type')!, /x-ndjson/);
	assert.match(response.headers.get('cache-control')!, /private.*no-store/); assert.equal(JSON.parse(await response.text()).totalEntries, 0);
	for (const query of ['pages=1', 'rootId=root&pages=0', 'rootId=root&pages=1&pages=1', 'rootId=root&pages=1&path=file', 'rootId=root&rootId=other&pages=1'])
		assert.equal((await handlers.loader({ request: request(query) })).status, 400);
	for (const identity of [null, { id: 'service', accountKind: 'service' }]) { user = identity;
		assert.equal((await handlers.loader({ request: request() })).status, 401); }
	user = { id: 'owner', accountKind: 'user' }; allowed = false;
	assert.equal((await handlers.loader({ request: request() })).status, 503); assert.equal(calls, 1);
});

test('live cloud changes keep private guards and reject mixed, duplicate and malformed cursors', async () => {
    let user: any = { id: 'owner', accountKind: 'user' }, allowed = true, calls = 0;
    const handlers = createFilesHandlers({ getUser: async () => user, limit: async () => ({ allowed, unavailable: !allowed } as any),
        inventory: async () => { throw Error('snapshot not requested'); }, folders: {} as any, service: {} as any,
        changes: async (owner, root, after, wait) => { calls++; assert.equal(owner, 'owner'); assert.equal(root, 'root');
            assert.equal(after, 42); assert.equal(wait, true);
            return { ok: true, feed: { version: 1, rootId: 'root', rootRevision: 'rev', cursor: 42, changes: [], hasMore: false } }; } });
    const request = (query: string) => new Request('https://example.test/api/v1/files?' + query);
    const response = await handlers.loader({ request: request('rootId=root&changes=1&after=42&wait=1') });
    assert.equal(response.status, 200); assert.match(response.headers.get('cache-control')!, /private.*no-store/);
    for (const query of ['rootId=root&changes=1&pages=1', 'rootId=root&changes=1&changes=1', 'rootId=root&changes=1&after=1&after=2',
        'rootId=root&changes=1&after=-1', 'rootId=root&changes=1&after=1.5', 'rootId=root&changes=1&after=01', 'rootId=root&changes=1&wait=0',
        'rootId=root&changes=1&path=secret', 'rootId=root&changes=1&subtreeId=folder'])
        assert.equal((await handlers.loader({ request: request(query) })).status, 400, query);
    assert.equal(calls, 1);
    user = { id: 'scoped', accountKind: 'service' }; assert.equal((await handlers.loader({ request: request('rootId=root&changes=1') })).status, 401);
    user = { id: 'owner', accountKind: 'user' }; allowed = false;
    assert.equal((await handlers.loader({ request: request('rootId=root&changes=1') })).status, 503); assert.equal(calls, 1);
});
